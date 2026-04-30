# 静态代码分析 - 认证与安全

> **分析目标**：通过阅读代码发现认证、授权和加密实现中的安全漏洞
> **涉及文件**：16 个文件（lib/auth/ 5 个 + lib/license/ 11 个）
> **优先级**：P0（安全关键）
> **预计耗时**：90 分钟

---

## 测试目的

**核心目标**：通过静态代码分析，发现认证系统中可能导致未授权访问、会话劫持、密码泄露的安全漏洞，确保系统的访问控制安全。

**具体要求**：
1. **全面分析**：仔细阅读每个代码文件，不得遗漏任何可能的问题点
2. **问题分类**：按 P0（致命）、P1（严重）、P2（中等）、P3（轻微）优先级分类
3. **修复方案**：针对发现的问题，给出简洁高效的最优化修复方案
4. **代码简洁**：修复方案需保持代码简洁，避免过度设计

**修复原则**：
- ✅ **保证功能正常**：修复后必须确保现有功能正常运行
- ✅ **不引入新错误**：修复方案不得引入新的报错或问题
- ✅ **面向现有功能**：非必要不兼容历史数据，优先满足当前功能需求
- ❌ **避免过度设计**：不为假设的未来需求增加复杂性

**重点关注**：
- 认证绕过漏洞（所有路径必须经过认证检查）
- Session ID 生成的随机性（必须使用 CSPRNG）
- Cookie 安全属性（HttpOnly, Secure, SameSite）
- 密码哈希算法强度（bcrypt/argon2）
- 时序攻击防护（恒定时间比较）

---

## 一、模块概述

### 1.1 功能描述

认证与安全模块负责：
- 用户认证（Session + API Token 双模式）
- 密码安全存储
- 授权码验证（V3 版本）
- API 密钥加密
- 访问限流

### 1.2 架构设计

```
lib/auth/
├── unified-auth.ts       # 统一认证入口（321 行）
├── session.ts            # Session 管理
├── api-token.ts          # API Token 管理
├── password.ts           # 密码哈希
└── rate-limit/           # 限流机制

lib/license/
├── validator-v3.ts       # 授权码验证（165 行）
├── crypto-simple.ts      # 加密实现（246 行）
├── generator.ts          # 授权码生成
├── hardware-id.ts        # 硬件标识
└── ...
```

### 1.3 关键文件列表

| 文件 | 行数 | 职责 |
|------|------|------|
| `unified-auth.ts` | 321 | 统一认证逻辑，请求验证 |
| `session.ts` | ~150 | Session 创建、验证、销毁 |
| `password.ts` | ~100 | 密码哈希和验证 |
| `validator-v3.ts` | 165 | 授权码验证逻辑 |
| `crypto-simple.ts` | 246 | AES 加密实现 |

---

## 二、分析检查清单

### 2.1 认证流程

| 检查项 | 文件 | 检查内容 | 状态 |
|--------|------|----------|------|
| SA-SEC-001 | `unified-auth.ts` | 认证绕过漏洞检查（所有路径） | ⬜ |
| SA-SEC-002 | `unified-auth.ts` | 认证状态缓存一致性 | ⬜ |
| SA-SEC-003 | `unified-auth.ts` | 认证失败响应是否泄露信息 | ⬜ |
| SA-SEC-004 | `unified-auth.ts` | 认证头部解析安全性 | ⬜ |

### 2.2 Session 管理

| 检查项 | 文件 | 检查内容 | 状态 |
|--------|------|----------|------|
| SA-SEC-005 | `session.ts` | Session ID 生成随机性（CSPRNG） | ⬜ |
| SA-SEC-006 | `session.ts` | Session 过期机制 | ⬜ |
| SA-SEC-007 | `session.ts` | Session 固定攻击防护 | ⬜ |
| SA-SEC-008 | `session.ts` | Cookie 安全属性（HttpOnly, Secure, SameSite） | ⬜ |

### 2.3 Token 管理

| 检查项 | 文件 | 检查内容 | 状态 |
|--------|------|----------|------|
| SA-SEC-009 | `api-token.ts` | Token 生成安全性 | ⬜ |
| SA-SEC-010 | `api-token.ts` | Token 撤销机制 | ⬜ |
| SA-SEC-011 | `api-token.ts` | Token 作用域限制 | ⬜ |

### 2.4 密码安全

| 检查项 | 文件 | 检查内容 | 状态 |
|--------|------|----------|------|
| SA-SEC-012 | `password.ts` | 密码哈希算法（bcrypt/argon2） | ⬜ |
| SA-SEC-013 | `password.ts` | 盐值生成和存储 | ⬜ |
| SA-SEC-014 | `password.ts` | 密码强度验证 | ⬜ |
| SA-SEC-015 | `password.ts` | 时序攻击防护（恒定时间比较） | ⬜ |

### 2.5 授权码系统

| 检查项 | 文件 | 检查内容 | 状态 |
|--------|------|----------|------|
| SA-SEC-016 | `validator-v3.ts` | 授权码验证逻辑正确性 | ⬜ |
| SA-SEC-017 | `validator-v3.ts` | 授权码过期处理 | ⬜ |
| SA-SEC-018 | `validator-v3.ts` | 硬件绑定验证 | ⬜ |
| SA-SEC-019 | `validator-v3.ts` | 离线验证安全性 | ⬜ |

### 2.6 加密实现

| 检查项 | 文件 | 检查内容 | 状态 |
|--------|------|----------|------|
| SA-SEC-020 | `crypto-simple.ts` | AES 加密模式正确性（GCM） | ⬜ |
| SA-SEC-021 | `crypto-simple.ts` | IV/Nonce 重用检查 | ⬜ |
| SA-SEC-022 | `crypto-simple.ts` | 密钥派生函数（PBKDF2/scrypt） | ⬜ |
| SA-SEC-023 | `crypto-simple.ts` | 密钥存储安全性 | ⬜ |

### 2.7 限流与防护

| 检查项 | 文件 | 检查内容 | 状态 |
|--------|------|----------|------|
| SA-SEC-024 | `rate-limit/` | 限流机制完整性 | ⬜ |
| SA-SEC-025 | `rate-limit/` | 限流绕过检查（IP 伪造） | ⬜ |
| SA-SEC-026 | API routes | 每个 API 端点的权限检查 | ⬜ |
| SA-SEC-027 | API routes | CSRF 防护机制 | ⬜ |

---

## 三、关键代码审查

### 3.1 unified-auth.ts - 统一认证

**审查重点**：
- [ ] 认证逻辑完整性
- [ ] 绕过漏洞
- [ ] 错误信息泄露

**代码位置**：`lib/auth/unified-auth.ts`

**需要检查的关键函数**：
- `authenticate()`：主认证函数
- `validateSession()`：Session 验证
- `validateApiToken()`：API Token 验证
- `handleAuthFailure()`：认证失败处理

**检查要点**：

1. **认证绕过**
   - 所有代码路径是否都经过认证检查
   - 是否有条件跳过认证的情况
   - 公开 API 和私有 API 是否正确区分

2. **Session vs Token**
   - 两种认证方式的优先级
   - 混合使用时的处理

3. **错误响应**
   - 认证失败是否泄露用户存在信息
   - 错误消息是否过于详细

---

### 3.2 session.ts - Session 管理

**审查重点**：
- [ ] Session ID 安全性
- [ ] 过期机制
- [ ] Cookie 安全

**代码位置**：`lib/auth/session.ts`

**需要检查的关键函数**：
- `createSession()`：创建 Session
- `validateSession()`：验证 Session
- `destroySession()`：销毁 Session
- `setSessionCookie()`：设置 Cookie

**检查要点**：

1. **Session ID 生成**
   - 是否使用 CSPRNG（crypto.randomBytes）
   - ID 长度是否足够（至少 128 位）
   - 是否有可预测性

2. **Cookie 安全**
   - HttpOnly：防止 XSS 窃取
   - Secure：仅 HTTPS 传输
   - SameSite：防止 CSRF

3. **Session 固定攻击**
   - 登录后是否重新生成 Session ID
   - 权限变更后是否刷新 Session

---

### 3.3 password.ts - 密码安全

**审查重点**：
- [ ] 哈希算法
- [ ] 盐值处理
- [ ] 时序攻击

**代码位置**：`lib/auth/password.ts`

**需要检查的关键函数**：
- `hashPassword()`：密码哈希
- `verifyPassword()`：密码验证
- `generateSalt()`：生成盐值

**检查要点**：

1. **哈希算法**
   - bcrypt 成本因子是否足够（建议 12+）
   - 或 argon2（推荐）

2. **盐值**
   - 是否每个密码独立盐值
   - 盐值是否随机生成
   - 盐值长度是否足够

3. **时序攻击防护**
   - 密码比较是否使用恒定时间
   - 使用 crypto.timingSafeEqual 或 bcrypt.compare

---

### 3.4 validator-v3.ts - 授权码验证

**审查重点**：
- [ ] 验证逻辑正确性
- [ ] 过期处理
- [ ] 硬件绑定

**代码位置**：`lib/license/validator-v3.ts`

**需要检查的关键函数**：
- `validateLicense()`：验证授权码
- `checkExpiration()`：检查过期
- `verifyHardwareBinding()`：验证硬件绑定
- `decryptLicense()`：解密授权码

**检查要点**：

1. **验证完整性**
   - 签名验证是否在解密前
   - 所有字段是否都被验证

2. **过期处理**
   - 时间比较是否正确
   - 时区处理

3. **硬件绑定**
   - 硬件 ID 获取是否可靠
   - 是否可被绕过

---

### 3.5 crypto-simple.ts - 加密实现

**审查重点**：
- [ ] 加密模式
- [ ] IV 使用
- [ ] 密钥管理

**代码位置**：`lib/license/crypto-simple.ts`

**需要检查的关键函数**：
- `encrypt()`：加密函数
- `decrypt()`：解密函数
- `deriveKey()`：密钥派生
- `generateIV()`：生成 IV

**检查要点**：

1. **加密模式**
   - 确认使用 AES-256-GCM（提供认证）
   - 避免 ECB 模式

2. **IV/Nonce**
   - 每次加密使用唯一 IV
   - GCM 模式 IV 长度 12 字节
   - IV 不应被重用（严重漏洞）

3. **密钥派生**
   - 从密码派生密钥使用 PBKDF2/scrypt/argon2
   - 迭代次数足够（PBKDF2 建议 100000+）

4. **密钥存储**
   - 密钥不应硬编码
   - 密钥不应记录在日志中

---

### 3.6 rate-limit/ - 限流机制

**审查重点**：
- [ ] 限流实现
- [ ] 绕过检查
- [ ] 配置合理性

**代码位置**：`lib/auth/rate-limit/`

**检查要点**：

1. **限流实现**
   - 基于什么标识限流（IP、用户、API Key）
   - 限流算法（滑动窗口、令牌桶）

2. **绕过检查**
   - IP 伪造（X-Forwarded-For）
   - 代理检测

3. **配置**
   - 限流阈值是否合理
   - 敏感操作是否有更严格限制

---

## 四、发现的问题

> 在实际分析代码后填写此部分

### 问题模板

**严重程度**：P0/P1/P2/P3
**文件位置**：`lib/auth/xxx.ts:123`
**检查项**：SA-SEC-XXX

**问题描述**：
（详细描述发现的问题）

**风险分析**：
（可能导致的后果）

**修复建议**：
（建议的修复方案）

---

## 五、分析结果汇总

| 指标 | 数值 |
|------|------|
| 检查项总数 | 27 |
| 已检查 | 0 |
| 发现问题 | 0 |
| P0 问题 | 0 |
| P1 问题 | 0 |
| P2 问题 | 0 |
| P3 问题 | 0 |

### 按类别统计

| 类别 | 检查项数 | 问题数 |
|------|---------|--------|
| 认证流程 | 4 | 0 |
| Session 管理 | 4 | 0 |
| Token 管理 | 3 | 0 |
| 密码安全 | 4 | 0 |
| 授权码系统 | 4 | 0 |
| 加密实现 | 4 | 0 |
| 限流与防护 | 4 | 0 |

---

## 六、修复方案

> 在发现问题后，针对每个问题给出具体的修复代码示例

### 常见修复模式

**Session Cookie 安全设置**：
```typescript
// 安全的 Cookie 设置
res.cookie('session', sessionId, {
  httpOnly: true,    // 防止 XSS 窃取
  secure: true,      // 仅 HTTPS
  sameSite: 'strict', // 防止 CSRF
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 天
});
```

**密码哈希（bcrypt）**：
```typescript
import bcrypt from 'bcrypt';

// 哈希密码
const SALT_ROUNDS = 12;
const hash = await bcrypt.hash(password, SALT_ROUNDS);

// 验证密码（内置恒定时间比较）
const isValid = await bcrypt.compare(password, hash);
```

**安全的随机数生成**：
```typescript
import crypto from 'crypto';

// 生成安全的 Session ID
const sessionId = crypto.randomBytes(32).toString('hex');

// 生成安全的 IV
const iv = crypto.randomBytes(12); // GCM 推荐 12 字节
```

---

## 附录：相关代码路径

```
lib/auth/
├── unified-auth.ts
├── session.ts
├── api-token.ts
├── password.ts
└── rate-limit/
    ├── index.ts
    └── ...

lib/license/
├── validator-v3.ts
├── crypto-simple.ts
├── generator.ts
├── hardware-id.ts
├── types.ts
└── ...
```

## 附录：安全检查清单

### 认证安全
- [ ] 所有敏感 API 都经过认证
- [ ] Session ID 使用 CSPRNG 生成
- [ ] Cookie 设置了正确的安全属性
- [ ] 登录后重新生成 Session ID

### 密码安全
- [ ] 使用 bcrypt 或 argon2 哈希密码
- [ ] 每个密码独立盐值
- [ ] 密码比较使用恒定时间

### 加密安全
- [ ] 使用 AES-256-GCM
- [ ] 每次加密使用唯一 IV
- [ ] 密钥使用 KDF 派生
- [ ] 密钥不硬编码、不记录日志

### 限流安全
- [ ] 登录接口有限流保护
- [ ] 敏感操作有更严格限制
- [ ] 正确处理代理头部
