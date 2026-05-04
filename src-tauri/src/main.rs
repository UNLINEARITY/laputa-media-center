use std::{
    env, fs,
    fs::OpenOptions,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::{path::BaseDirectory, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

struct ServerProcess(Arc<Mutex<Option<Child>>>);

impl ServerProcess {
    fn shutdown(&self) {
        if let Ok(mut child_slot) = self.0.lock() {
            if let Some(mut child) = child_slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn main() {
    let server_child = Arc::new(Mutex::new(None));
    let setup_server_child = Arc::clone(&server_child);

    let app = tauri::Builder::default()
        .manage(ServerProcess(server_child))
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<ServerProcess>().shutdown();
            }
        })
        .setup(move |app| {
            let bundle_dir = normalize_windows_path(
                app.path()
                    .resolve("laputa-desktop", BaseDirectory::Resource)?,
            );
            let resources_dir = bundle_dir.join("resources");
            let app_data_dir = resolve_app_data_dir();
            prepare_app_dirs(&app_data_dir)?;

            let port = find_free_port()?;
            let mut child = start_server(&bundle_dir, &resources_dir, &app_data_dir, port)?;
            if let Err(error) = wait_for_health(port, &mut child, Duration::from_secs(90)) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }

            *setup_server_child.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "server lock poisoned")
            })? = Some(child);

            let url = format!("http://127.0.0.1:{port}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("LaputaMediaCenter")
                .inner_size(1280.0, 860.0)
                .min_inner_size(1024.0, 720.0)
                .resizable(true)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building LaputaMediaCenter desktop app");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            app_handle.state::<ServerProcess>().shutdown();
        }
    });
}

fn resolve_app_data_dir() -> PathBuf {
    if let Some(configured) = env::var_os("LMC_APP_DATA_DIR") {
        return PathBuf::from(configured);
    }

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local_app_data).join("LaputaMediaCenter");
    }

    env::temp_dir().join("LaputaMediaCenter")
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path
}

fn prepare_app_dirs(app_data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(app_data_dir)?;
    fs::create_dir_all(app_data_dir.join("runtime"))?;
    fs::create_dir_all(app_data_dir.join("runtime").join("temp"))?;
    fs::create_dir_all(app_data_dir.join("runtime").join("output"))?;
    fs::create_dir_all(app_data_dir.join("logs"))?;
    Ok(())
}

fn find_free_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn start_server(
    bundle_dir: &Path,
    resources_dir: &Path,
    app_data_dir: &Path,
    port: u16,
) -> Result<Child, Box<dyn std::error::Error>> {
    let node_exe = resources_dir.join("node").join("node.exe");
    let server_js = bundle_dir.join("server.js");
    if !node_exe.exists() {
        return Err(format!("Bundled node.exe not found: {}", node_exe.display()).into());
    }
    if !server_js.exists() {
        return Err(format!("Bundled server.js not found: {}", server_js.display()).into());
    }

    let runtime_dir = app_data_dir.join("runtime");
    let temp_dir = runtime_dir.join("temp");
    let output_dir = runtime_dir.join("output");
    let database_path = app_data_dir.join("laputa.sqlite");
    let ffmpeg_dir = resources_dir.join("bin").join("ffmpeg");
    let yt_dlp = resources_dir.join("bin").join("yt-dlp").join("yt-dlp.exe");
    let whisper_cli = resources_dir
        .join("bin")
        .join("whisper")
        .join("whisper-cli.exe");
    let python_exe = resources_dir.join("python").join("python.exe");
    let log_path = app_data_dir.join("logs").join("desktop-server.log");
    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    writeln!(
        log_file,
        "\n[desktop] starting sidecar bundle={} resources={} port={port}",
        bundle_dir.display(),
        resources_dir.display()
    )?;
    let stderr_log = log_file.try_clone()?;
    let stdout_log = log_file.try_clone()?;

    let mut command = Command::new(node_exe);
    command
        .current_dir(bundle_dir)
        .arg("server.js")
        .env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("LMC_LITE_MODE", "true")
        .env("LMC_LITE_RESOURCES_DIR", resources_dir)
        .env("LMC_APP_DATA_DIR", app_data_dir)
        .env("RUNTIME_DIR", &runtime_dir)
        .env("TEMP_DIR", &temp_dir)
        .env("OUTPUT_DIR", &output_dir)
        .env("DATABASE_URL", format!("file:{}", database_path.display()))
        .env("AUTH_ENABLED", "false")
        .env("LMC_BYPASS_LICENSE", "true")
        .env("LMC_SKIP_BROWSER", "true")
        .env("INGEST_FFMPEG_EXE", ffmpeg_dir.join("ffmpeg.exe"))
        .env("DUBBING_FFMPEG_EXE", ffmpeg_dir.join("ffmpeg.exe"))
        .env("INGEST_FFPROBE_EXE", ffmpeg_dir.join("ffprobe.exe"))
        .env("DUBBING_FFPROBE_EXE", ffmpeg_dir.join("ffprobe.exe"))
        .env("INGEST_YTDLP_EXE", yt_dlp)
        .env("WHISPER_CPP_PATH", whisper_cli)
        .env("WHISPER_CPP_MODEL", "base")
        .env("DUBBING_PYTHON_EXE", python_exe)
        .env("DUBBING_SKILL_DIR", resources_dir)
        .env("PATH", desktop_path(resources_dir))
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    Ok(command.spawn()?)
}

fn desktop_path(resources_dir: &Path) -> String {
    let mut paths = vec![
        resources_dir.join("node"),
        resources_dir.join("python"),
        resources_dir.join("bin").join("ffmpeg"),
        resources_dir.join("bin").join("yt-dlp"),
        resources_dir.join("bin").join("whisper"),
    ];

    if let Some(existing) = env::var_os("PATH") {
        paths.extend(env::split_paths(&existing));
    }

    env::join_paths(paths)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn wait_for_health(
    port: u16,
    child: &mut Child,
    timeout: Duration,
) -> Result<(), Box<dyn std::error::Error>> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            return Err(format!("Next server exited before ready: {status}").into());
        }

        if health_check(port).unwrap_or(false) {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(300));
    }

    Err(format!("Next server did not become ready on 127.0.0.1:{port}").into())
}

fn health_check(port: u16) -> Result<bool, Box<dyn std::error::Error>> {
    let addr = ("127.0.0.1", port)
        .to_socket_addrs()?
        .next()
        .ok_or("could not resolve local health address")?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500))?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")?;

    let mut buffer = [0; 128];
    let read = stream.read(&mut buffer)?;
    let status = String::from_utf8_lossy(&buffer[..read]);
    Ok(status.starts_with("HTTP/1.1 200") || status.starts_with("HTTP/1.0 200"))
}
