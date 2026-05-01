/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DubbingForm, type DubbingFormValues } from '@/components/dubbing/dubbing-form'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const runtimeStatus = {
  available: true,
  allow_placeholder_tts: false,
  missing_required: [],
  guidance: 'ready',
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
  )
}

function setupFetch(
  profile: Record<string, unknown> = {},
  voices: unknown[] = [],
  projectGlossary = '',
  options: { failVoiceSelectionPreview?: boolean } = {},
) {
  let voiceList: Array<Record<string, unknown>> = voices
    .filter((voice) => voice && typeof voice === 'object' && !Array.isArray(voice))
    .map((voice) => ({ ...(voice as Record<string, unknown>) }))

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method || 'GET'

    if (url === '/api/dubbing/voices' && method === 'GET') {
      return jsonResponse({ voices: voiceList })
    }
    if (url === '/api/dubbing/voices/select' && method === 'POST') {
      if (options.failVoiceSelectionPreview) {
        return jsonResponse({ error: 'preview failed' }, { status: 500 })
      }
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      const speakerHint = String(body.speakerHint || '').toLowerCase()
      const preferredGender = typeof body.preferredGender === 'string' ? body.preferredGender : ''
      const sortedVoices = [...voiceList].sort((a, b) => {
        const priorityDelta = Number(b.priority || 0) - Number(a.priority || 0)
        if (priorityDelta !== 0) return priorityDelta
        return String(a.voice_id || '').localeCompare(String(b.voice_id || ''))
      })
      const requestedVoice =
        typeof body.requestedVoiceId === 'string'
          ? sortedVoices.find((voice) => voice.voice_id === body.requestedVoiceId)
          : undefined
      const aliasMatchedVoice = sortedVoices.find((voice) => {
        const candidates = [
          voice.display_name,
          ...(Array.isArray(voice.speaker_aliases) ? voice.speaker_aliases : []),
          ...(Array.isArray(voice.applicable_people) ? voice.applicable_people : []),
        ]
          .map((item) => (typeof item === 'string' ? item.toLowerCase() : ''))
          .filter(Boolean)

        return candidates.some((candidate) => speakerHint.includes(candidate))
      })
      const genericMatchedVoice = sortedVoices.find((voice) => {
        const category = String(voice.category || '')
        const gender = String(voice.gender || '')
        return (
          (category === 'generic' || category === 'synthetic_narration') &&
          (!preferredGender || gender === preferredGender || gender === 'neutral')
        )
      })
      const matchedVoice = requestedVoice || aliasMatchedVoice || genericMatchedVoice
      const source = requestedVoice
        ? 'explicit'
        : aliasMatchedVoice
          ? 'speaker_registry'
          : genericMatchedVoice
            ? 'generic_registry'
            : 'none'

      return jsonResponse({
        ok: true,
        external_call: false,
        paid_verification_called: false,
        registry_total: voiceList.length,
        selection: {
          voice_id: matchedVoice?.voice_id || '',
          source,
          matched_alias:
            aliasMatchedVoice && Array.isArray(aliasMatchedVoice.speaker_aliases)
              ? aliasMatchedVoice.speaker_aliases[0]
              : undefined,
          disclosure_status: matchedVoice?.requires_disclosure ? 'required' : 'not_required',
          disclosure_required: matchedVoice?.requires_disclosure === true,
          usage_label: matchedVoice?.usage_label || '注册表自动匹配',
          reason: aliasMatchedVoice
            ? '根据讲者提示匹配已保存声线。'
            : genericMatchedVoice
              ? '没有可靠讲者匹配，使用已保存的 MiniMax 通用旁白声线。'
              : matchedVoice
                ? '用户已明确指定 voice_id。'
                : '没有可用声线。',
          display_name: matchedVoice?.display_name,
          category: matchedVoice?.category,
          gender: matchedVoice?.gender,
          public_figure: matchedVoice?.public_figure,
          authorized: matchedVoice?.authorized,
        },
      })
    }
    if (url === '/api/dubbing/voices' && method === 'POST') {
      return jsonResponse({ exists: true })
    }
    if (url === '/api/dubbing/voices' && method === 'PUT') {
      const body = JSON.parse(String(init?.body || '{}'))
      const voice = {
        voice_id: body.voiceId,
        ref_audio: body.refAudio || 'manual',
        created_at: 'manual-save',
        updated_at: 'manual-save',
        display_name: body.displayName || body.voiceId,
        category: body.category || 'synthetic_narration',
        gender: body.gender,
        languages: body.languages || [],
        speaker_aliases: body.speakerAliases || [],
        public_figure: body.publicFigure ?? false,
        authorized: body.authorized ?? false,
        requires_disclosure: body.requiresDisclosure ?? true,
        usage_label: body.usageLabel || '手动保存未登记声线，需确认授权或标注 AI 翻译配音',
        notes: body.notes,
        priority: body.priority || 0,
      }
      voiceList = [...voiceList.filter((item) => item?.voice_id !== voice.voice_id), voice]
      return jsonResponse({ voice })
    }
    if (url === '/api/dubbing/voices' && method === 'DELETE') {
      const body = JSON.parse(String(init?.body || '{}'))
      const existed = voiceList.some((item) => item?.voice_id === body.voiceId)
      voiceList = voiceList.filter((item) => item?.voice_id !== body.voiceId)
      return jsonResponse({ voice_id: body.voiceId, removed: existed })
    }
    if (url === '/api/dubbing/status') {
      return jsonResponse(runtimeStatus)
    }
    if (url === '/api/configs/dubbing.project_glossary' && method === 'GET') {
      return jsonResponse({ value: '' })
    }
    if (url === '/api/configs/dubbing_project_glossary' && method === 'GET') {
      return jsonResponse({ value: projectGlossary })
    }
    if (url === '/api/configs/dubbing_project_glossary' && method === 'PUT') {
      return jsonResponse({ success: true })
    }
    if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
      return jsonResponse({ value: JSON.stringify(profile) })
    }
    if (url === '/api/configs/laputa_creator_profile' && method === 'PUT') {
      return jsonResponse({ success: true })
    }

    return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('DubbingForm creator assets', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('prefills both primary and secondary voices from creator assets', async () => {
    setupFetch({
      default_voice_id: 'voice-main',
      secondary_voice_id: 'voice-guest',
      default_audience: '廣東話觀眾',
    })

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    expect(screen.getByDisplayValue('voice-guest')).toBeTruthy()
    expect(screen.getAllByText('第二声线').length).toBeGreaterThan(0)
    expect(screen.getByText('默认第二声线')).toBeTruthy()
  })

  it('does not show creator default voices without registry metadata as disclosure-free', async () => {
    setupFetch({
      default_voice_id: 'voice-main',
      default_audience: '廣東話觀眾',
    })

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    expect(screen.getByText('未记录披露要求')).toBeTruthy()
    expect(screen.getByText('待确认披露')).toBeTruthy()
    expect(
      screen.getByText(
        '这条声线缺少披露元数据；提交前请确认授权，无法确认时保守标注 AI 翻译配音。',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('未要求额外披露')).toBeNull()
  })

  it('keeps the creator default voice ahead of cloned voice auto selection', async () => {
    setupFetch(
      {
        default_voice_id: 'voice-from-profile',
      },
      [{ voice_id: 'voice-first-cloned', created_at: '2026-04-26' }],
    )

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByDisplayValue('voice-from-profile')).toBeTruthy()
    expect(screen.queryByDisplayValue('voice-first-cloned')).toBeNull()
  })

  it('previews automatic voice matching without locking the submitted voice id', async () => {
    const fetchMock = setupFetch({}, [
      {
        voice_id: 'voice-trump',
        display_name: '特朗普评论声线',
        category: 'public_figure_commentary',
        gender: 'male',
        speaker_aliases: ['特朗普'],
        public_figure: true,
        authorized: true,
        requires_disclosure: true,
        usage_label: '名人素材翻译/评论配音，需明确标注非本人原声',
        priority: 20,
      },
    ])
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>()

    render(<DubbingForm onSubmit={onSubmit} />)

    fireEvent.change(await screen.findByLabelText('视频来源'), {
      target: { value: 'C:\\videos\\trump.mp4' },
    })
    fireEvent.change(screen.getByPlaceholderText('例如：Dr. Smith，心脏科医生'), {
      target: { value: '特朗普采访' },
    })

    expect(await screen.findByText('预计匹配：特朗普评论声线')).toBeTruthy()
    expect(screen.getByText('声线选择')).toBeTruthy()
    expect(screen.getAllByText('voice-trump').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/讲者声线库/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('男声').length).toBeGreaterThan(0)
    expect(screen.getAllByText('公众人物').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/需明确标注非本人原声/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('checkbox', { name: /已确认声线使用边界/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始转译/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      voiceId: '',
      creatorContext: {
        speakerIdentity: '特朗普采访',
      },
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/dubbing/voices/select')).toBe(
      true,
    )
  })

  it('uses source label in the same automatic voice preview hint as job creation', async () => {
    const fetchMock = setupFetch({}, [
      {
        voice_id: 'voice-generic',
        display_name: '通用旁白声线',
        category: 'generic',
        requires_disclosure: false,
        usage_label: 'MiniMax 通用旁白声线',
        priority: 100,
      },
      {
        voice_id: 'voice-trump',
        display_name: '特朗普评论声线',
        category: 'public_figure_commentary',
        speaker_aliases: ['Donald Trump'],
        public_figure: true,
        requires_disclosure: true,
        usage_label: '名人素材翻译/评论配音，需明确标注非本人原声',
        priority: 1,
      },
    ])

    render(<DubbingForm onSubmit={vi.fn()} sourceLabel="Donald Trump interview source" />)

    expect(await screen.findByText('预计匹配：特朗普评论声线')).toBeTruthy()
    const selectCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/dubbing/voices/select',
    )
    const body = JSON.parse(String(selectCall?.[1]?.body || '{}'))

    expect(body.speakerHint).toContain('Donald Trump interview source')
    expect(body).not.toHaveProperty('defaultVoiceId')
  })

  it('blocks automatic voice submission when the server preview is unavailable', async () => {
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>(async () => {})
    const fetchMock = setupFetch(
      {},
      [
        {
          voice_id: 'voice-generic',
          display_name: '通用旁白声线',
          category: 'generic',
          requires_disclosure: false,
          usage_label: 'MiniMax 通用旁白声线',
          priority: 10,
        },
      ],
      '',
      { failVoiceSelectionPreview: true },
    )

    render(
      <DubbingForm
        onSubmit={onSubmit}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceUsageConfirmed: true,
        }}
      />,
    )

    expect(await screen.findByText('通用旁白声线')).toBeTruthy()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/dubbing/voices/select'),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('正在预览声线自动匹配')).toBeNull())

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    fireEvent.click(submitButton)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows a clear blocker when no voice id, registry voice, or default voice exists', async () => {
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>(async () => {})
    setupFetch()

    render(
      <DubbingForm
        onSubmit={onSubmit}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceUsageConfirmed: true,
        }}
      />,
    )

    expect(await screen.findByText('声线选择')).toBeTruthy()
    expect(screen.getAllByText('未匹配').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/请先填写 MiniMax voice_id/).length).toBeGreaterThan(0)

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    fireEvent.click(submitButton)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('resets usage-boundary acknowledgement when automatic voice selection changes', async () => {
    setupFetch({}, [
      {
        voice_id: 'voice-generic',
        display_name: '通用女声旁白',
        category: 'generic',
        gender: 'female',
        requires_disclosure: false,
        usage_label: 'MiniMax 通用旁白声线',
        priority: 10,
      },
      {
        voice_id: 'voice-trump',
        display_name: '特朗普评论声线',
        category: 'public_figure_commentary',
        gender: 'male',
        speaker_aliases: ['特朗普'],
        public_figure: true,
        requires_disclosure: true,
        usage_label: '名人素材翻译/评论配音，需明确标注非本人原声',
        priority: 20,
      },
    ])

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceUsageConfirmed: true,
        }}
      />,
    )

    const checkbox = (await screen.findByRole('checkbox', {
      name: /已确认声线使用边界/,
    })) as HTMLInputElement
    expect(await screen.findByText('预计匹配：通用女声旁白')).toBeTruthy()
    expect(checkbox.checked).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('例如：Dr. Smith，心脏科医生'), {
      target: { value: '特朗普采访' },
    })

    expect(await screen.findByText('预计匹配：特朗普评论声线')).toBeTruthy()
    await waitFor(() => expect(checkbox.checked).toBe(false))
  })

  it('does not auto-verify unsaved prefilled voices through the MiniMax voice endpoint', async () => {
    const fetchMock = setupFetch()

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceId: 'voice-prefill',
          voiceUsageConfirmed: true,
        }}
      />,
    )

    expect(await screen.findByDisplayValue('voice-prefill')).toBeTruthy()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
    })

    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('shows run scope and applied long-term assets before submitting', async () => {
    setupFetch({
      default_voice_id: 'voice-main',
      secondary_voice_id: 'voice-guest',
      default_audience: '华语创作者',
      default_wording_style: 'professional',
    })

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    expect(screen.getByText('运行前确认')).toBeTruthy()
    expect(screen.getByText('全片正式转译')).toBeTruthy()
    expect(screen.getAllByText('4 项').length).toBeGreaterThan(0)
    expect(screen.getByText('会套用：长期受众、用词倾向、主声线、第二声线')).toBeTruthy()
    expect(screen.getByText('等待边界确认')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /60 秒样片/ }))

    expect(screen.getAllByText('60 秒样片').length).toBeGreaterThan(0)
    expect(screen.getByText('先验证声线、语气、口型和固定读法，再扩到全片。')).toBeTruthy()
    expect(screen.getByRole('button', { name: /开始样片/ })).toBeTruthy()
  })

  it('previews concrete long-term style and glossary rules before submitting', async () => {
    setupFetch(
      {
        default_voice_id: 'voice-main',
        secondary_voice_id: 'voice-guest',
        default_audience: '华语创作者',
        default_wording_style: 'professional',
        mandarin_style_guide: '语气节奏：像老朋友解释，数字读法要自然。',
      },
      [],
      'Wave59 -> Wave五十九 # 固定读法\n99年 -> 九九年',
    )

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    expect(screen.getAllByText('6 项').length).toBeGreaterThan(0)
    expect(
      screen.getByText((content) =>
        content.includes('会套用：长期受众、用词倾向、主声线、第二声线，另 2 项'),
      ),
    ).toBeTruthy()
    expect(
      screen.getByText((content) => content.includes('普通话风格：语气节奏：像老朋友解释')),
    ).toBeTruthy()
    expect(
      screen.getByText((content) =>
        content.includes('固定读法：Wave59 -> Wave五十九 # 固定读法；99年 -> 九九年'),
      ),
    ).toBeTruthy()
  })

  it('merges source-job glossary prefill with long-term glossary before submitting', async () => {
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>(async () => {})
    setupFetch(
      {},
      [{ voice_id: 'voice-main', created_at: 'saved' }],
      'Lars -> Lars von Thienen\nWave59 -> 旧读法',
    )

    render(
      <DubbingForm
        onSubmit={onSubmit}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceId: 'voice-main',
          voiceUsageConfirmed: true,
          localizationGlossary: [
            { source: 'Wave59', target: 'Wave五十九', note: '来源任务固定读法' },
            { source: '99年', target: '九九年' },
          ],
        }}
      />,
    )

    const glossaryField = (await screen.findByPlaceholderText(
      /Lars Vontine/,
    )) as HTMLTextAreaElement
    await waitFor(() => {
      expect(glossaryField.value).toContain('Lars -> Lars von Thienen')
      expect(glossaryField.value).toContain('Wave59 -> Wave五十九 # 来源任务固定读法')
      expect(glossaryField.value).toContain('99年 -> 九九年')
      expect(glossaryField.value).not.toContain('Wave59 -> 旧读法')
    })

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false))
    fireEvent.click(submitButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0].localizationGlossary).toEqual(
      expect.arrayContaining([
        { source: 'Lars', target: 'Lars von Thienen' },
        { source: 'Wave59', target: 'Wave五十九', note: '来源任务固定读法' },
        { source: '99年', target: '九九年' },
      ]),
    )
  })

  it('keeps user-edited fields when source job prefill hydrates late', async () => {
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>(async () => {})
    setupFetch()

    const { rerender } = render(
      <DubbingForm onSubmit={onSubmit} initialValues={{ targetLanguage: 'mandarin' }} />,
    )

    const videoField = (await screen.findByLabelText('视频来源')) as HTMLInputElement
    const targetLanguageField = screen.getByLabelText('输出语言') as HTMLSelectElement
    const voiceField = screen.getByLabelText('目标声线') as HTMLInputElement
    const contentBriefField = screen.getByPlaceholderText(/这是一段医生/) as HTMLTextAreaElement
    const targetAudienceField = screen.getByLabelText('目标受众') as HTMLInputElement
    const glossaryField = screen.getByPlaceholderText(/Lars Vontine/) as HTMLTextAreaElement

    fireEvent.change(videoField, { target: { value: 'C:\\tmp\\manual.mp4' } })
    fireEvent.change(targetLanguageField, { target: { value: 'cantonese' } })
    fireEvent.change(voiceField, { target: { value: 'voice-manual' } })
    fireEvent.change(contentBriefField, { target: { value: '用户手动 brief' } })
    fireEvent.change(targetAudienceField, { target: { value: '用户手动受众' } })
    fireEvent.change(glossaryField, { target: { value: 'Manual -> 手动规则' } })

    rerender(
      <DubbingForm
        onSubmit={onSubmit}
        initialValues={{
          videoUrl: 'C:\\tmp\\source-job.mp4',
          sourceLanguage: 'en',
          targetLanguage: 'mandarin',
          voiceId: 'voice-from-source',
          secondaryVoiceId: 'guest-from-source',
          voiceUsageConfirmed: true,
          creatorContext: {
            contentBrief: '来源任务 brief',
            speakerIdentity: '来源讲者',
            targetAudience: '来源任务受众',
            wordingStyle: 'professional',
            languageStyle: '来源任务风格',
            revisionNotes: '来源任务 QA 修稿重点',
          },
          localizationGlossary: [
            { source: 'Wave59', target: 'Wave五十九', note: '来源任务固定读法' },
          ],
        }}
      />,
    )

    const sourceLanguageField = screen.getByLabelText('原始语言') as HTMLSelectElement
    const secondaryVoiceField = screen.getByLabelText('第二声线') as HTMLInputElement
    await waitFor(() => expect(sourceLanguageField.value).toBe('en'))

    expect(videoField.value).toBe('C:\\tmp\\manual.mp4')
    expect(targetLanguageField.value).toBe('cantonese')
    expect(voiceField.value).toBe('voice-manual')
    expect(contentBriefField.value).toBe('用户手动 brief')
    expect(targetAudienceField.value).toBe('用户手动受众')
    expect(glossaryField.value).toContain('Manual -> 手动规则')
    expect(glossaryField.value).not.toContain('Wave59')

    expect(secondaryVoiceField.value).toBe('guest-from-source')
    const revisionNotesField = (await screen.findByLabelText('QA 修稿重点')) as HTMLTextAreaElement
    expect(revisionNotesField.value).toBe('来源任务 QA 修稿重点')

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(true))
    expect(screen.getByText('等待边界确认')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /已确认声线使用边界/ }))
    await waitFor(() => expect(submitButton.disabled).toBe(false))
    fireEvent.click(submitButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const submitted = onSubmit.mock.calls[0]?.[0] as DubbingFormValues

    expect(submitted.videoUrl).toBe('C:\\tmp\\manual.mp4')
    expect(submitted.sourceLanguage).toBe('en')
    expect(submitted.targetLanguage).toBe('cantonese')
    expect(submitted.voiceId).toBe('voice-manual')
    expect(submitted.secondaryVoiceId).toBe('guest-from-source')
    expect(submitted.creatorContext.contentBrief).toBe('用户手动 brief')
    expect(submitted.creatorContext.targetAudience).toBe('用户手动受众')
    expect(submitted.creatorContext.revisionNotes).toBe('来源任务 QA 修稿重点')
    expect(submitted.localizationGlossary).toEqual([{ source: 'Manual', target: '手动规则' }])
    expect(submitted.voiceUsageConfirmed).toBe(true)
  })

  it('keeps sample-to-full snapshot preview isolated from current project glossary and creator profile', async () => {
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>(async () => {})
    setupFetch(
      {
        default_voice_id: 'voice-current-profile',
        secondary_voice_id: 'guest-current-profile',
        default_audience: '当前长期受众',
        default_wording_style: 'plain',
        cantonese_style_guide: '当前项目新增风格：不要进入样片升级。',
      },
      [{ voice_id: 'voice-sample', created_at: 'saved' }],
      'NewTerm -> 当前项目新词\nWave59 -> 当前项目旧读法',
    )

    render(
      <DubbingForm
        onSubmit={onSubmit}
        initialValues={
          {
            videoUrl: 'C:\\tmp\\source.mp4',
            targetLanguage: 'cantonese',
            voiceId: 'voice-sample',
            secondaryVoiceId: 'guest-sample',
            voiceUsageConfirmed: true,
            sampleToFull: true,
            sampleAssetSnapshot: true,
            creatorContext: {
              contentBrief: '',
              speakerIdentity: '',
              targetAudience: '样片锁定受众',
              wordingStyle: 'professional',
              languageStyle: '样片锁定风格：Wave59 读 Wave五十九。',
              revisionNotes: '',
            },
            localizationGlossary: [
              { source: 'Wave59', target: 'Wave五十九', note: '样片锁定读法' },
            ],
          } as Partial<DubbingFormValues> & { sampleAssetSnapshot: boolean }
        }
      />,
    )

    expect(await screen.findByText('运行前确认')).toBeTruthy()
    expect(screen.getByText('已套用样片资产')).toBeTruthy()
    expect(screen.getByText('可沉淀为长期资产')).toBeTruthy()
    expect(screen.getByRole('button', { name: /沉淀样片资产为长期资产/ })).toBeTruthy()
    expect(
      screen.getByText((content) => content.includes('广东话 / 粤语风格：样片锁定风格')),
    ).toBeTruthy()
    expect(
      screen.getByText((content) =>
        content.includes('固定读法：Wave59 -> Wave五十九 # 样片锁定读法'),
      ),
    ).toBeTruthy()
    expect(screen.queryByText((content) => content.includes('当前项目新增风格'))).toBeNull()
    expect(screen.queryByText((content) => content.includes('NewTerm'))).toBeNull()
    expect(screen.queryByText((content) => content.includes('当前项目旧读法'))).toBeNull()

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false))
    fireEvent.click(submitButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const submitted = onSubmit.mock.calls[0]?.[0] as DubbingFormValues & {
      sampleAssetSnapshot?: boolean
      useSampleAssetSnapshot?: boolean
    }
    expect(submitted.sampleToFull).toBe(true)
    expect(submitted.sampleAssetSnapshot ?? submitted.useSampleAssetSnapshot).toBe(true)
    expect(submitted.creatorContext.languageStyle).toBe('样片锁定风格：Wave59 读 Wave五十九。')
    expect(submitted.localizationGlossary).toEqual([
      { source: 'Wave59', target: 'Wave五十九', note: '样片锁定读法' },
    ])
  })

  it('previews source-job language style before submitting even without a profile style', async () => {
    setupFetch()

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          targetLanguage: 'cantonese',
          creatorContext: {
            contentBrief: '',
            speakerIdentity: '',
            targetAudience: '',
            wordingStyle: 'auto',
            languageStyle: '自然香港粤语，慢一点，Wave59 读 Wave五十九。',
            revisionNotes: '',
          },
        }}
      />,
    )

    expect(await screen.findByText('运行前确认')).toBeTruthy()
    expect(screen.getAllByText('1 项').length).toBeGreaterThan(0)
    expect(
      screen.getByText((content) =>
        content.includes('广东话 / 粤语风格：自然香港粤语，慢一点，Wave59 读 Wave五十九。'),
      ),
    ).toBeTruthy()
    expect(screen.getByText('本次规则')).toBeTruthy()
  })

  it('shows QA revision notes in the pre-submit confirmation', async () => {
    setupFetch()

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          creatorContext: {
            contentBrief: '',
            speakerIdentity: '',
            targetAudience: '',
            wordingStyle: 'auto',
            languageStyle: '',
            revisionNotes: '本次根据已保存 QA 摘要修版：\n1. 放慢停顿。\n2. 修正 Wave59 读法。',
          },
        }}
      />,
    )

    expect(await screen.findByLabelText('QA 修稿重点')).toBeTruthy()
    expect(screen.getByText('本次修稿')).toBeTruthy()
    expect(screen.getByText('2 条')).toBeTruthy()
    expect(screen.getByText('来源：已保存 QA 摘要')).toBeTruthy()
    expect(screen.getByText('会带入：放慢停顿。')).toBeTruthy()
  })

  it('labels manual revision notes before submitting', async () => {
    setupFetch()

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          creatorContext: {
            contentBrief: '',
            speakerIdentity: '',
            targetAudience: '',
            wordingStyle: 'auto',
            languageStyle: '',
            revisionNotes: '手动提醒：Wave59 按固定读法处理。',
          },
        }}
      />,
    )

    expect(await screen.findByLabelText('QA 修稿重点')).toBeTruthy()
    expect(screen.getByText('本次修稿')).toBeTruthy()
    expect(screen.getByText('1 条')).toBeTruthy()
    expect(screen.getByText('来源：手动备注')).toBeTruthy()
  })

  it('previews and confirms saving a manual voice into the local voice list', async () => {
    const fetchMock = setupFetch()

    render(<DubbingForm onSubmit={vi.fn()} />)

    const voiceField = await screen.findByLabelText('目标声线')
    fireEvent.change(voiceField, {
      target: { value: 'voice-manual' },
    })

    expect(screen.getByText('将保存到本地常用声线清单')).toBeTruthy()
    expect(screen.getAllByText('voice-manual').length).toBeGreaterThan(0)
    expect(screen.getByText('手动指定未登记声线')).toBeTruthy()
    expect(screen.getByText('需要标注 AI 翻译配音')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /保存声线/ }))

    expect(await screen.findByText('声线已保存到本地常用清单，后续任务可直接选择。')).toBeTruthy()
    expect(screen.getByText('手动保存未登记声线')).toBeTruthy()
    expect(
      await screen.findByText(
        '这个 voice_id 只是在本地声线清单中登记；尚未执行 MiniMax 付费验证。',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('这个 voice_id 已通过 MiniMax 付费验证。')).toBeNull()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'PUT',
        ),
      ).toBe(true),
    )

    const putCall = fetchMock.mock.calls.find(
      ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body))
    expect(body).toMatchObject({
      voiceId: 'voice-manual',
      refAudio: 'manual',
      category: 'synthetic_narration',
      authorized: false,
      requiresDisclosure: true,
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('shows saved voice usage labels and disclosure requirements before submitting', async () => {
    setupFetch({}, [
      {
        voice_id: 'voice-trump',
        display_name: 'Trump commentary voice',
        created_at: '2026-04-28',
        category: 'authorized_clone',
        gender: 'male',
        public_figure: true,
        authorized: true,
        requires_disclosure: true,
        usage_label: '名人素材翻译/评论配音，需明确标注非本人原声',
      },
    ])

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByText('Trump commentary voice')).toBeTruthy()
    expect(screen.getByText('授权克隆声线')).toBeTruthy()
    expect(screen.getAllByText('男声').length).toBeGreaterThan(0)
    expect(screen.getAllByText('公众人物').length).toBeGreaterThan(0)
    expect(screen.getByText('本地授权记录')).toBeTruthy()
    expect(screen.getAllByText('需披露').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('名人素材翻译/评论配音，需明确标注非本人原声').length,
    ).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Trump commentary voice/ }))
    expect(
      await screen.findByText(
        '这个 voice_id 只是在本地声线清单中登记；尚未执行 MiniMax 付费验证。',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('这个 voice_id 已通过 MiniMax 付费验证。')).toBeNull()
    expect(
      await screen.findByText(
        '这条声线需要在成片或发布说明中标注 AI 翻译配音，不能呈现为本人原声。',
      ),
    ).toBeTruthy()
  })

  it('prioritizes saved voice metadata without writing it as an explicit voice selection', async () => {
    setupFetch({}, [
      {
        voice_id: 'voice-low',
        display_name: '低优先级声线',
        created_at: '2026-04-28',
        category: 'generic',
        authorized: true,
        requires_disclosure: false,
        usage_label: 'MiniMax 通用旁白声线',
        priority: 1,
      },
      {
        voice_id: 'voice-high',
        display_name: '高优先级声线',
        created_at: '2026-04-28',
        category: 'generic',
        authorized: true,
        requires_disclosure: false,
        usage_label: 'MiniMax 通用旁白声线',
        priority: 50,
      },
    ])

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByText('高优先级声线')).toBeTruthy()
    expect((screen.getByLabelText('目标声线') as HTMLInputElement).value).toBe('')
    expect(await screen.findByText('预计匹配：高优先级声线')).toBeTruthy()
    expect(
      (screen.getByRole('link', { name: /管理声线元数据/ }) as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe('/settings#minimax_tts')
  })

  it('lets the server voice registry choose a voice when no explicit voice id is set', async () => {
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>(async () => {})
    setupFetch({}, [
      {
        voice_id: 'voice-generic',
        display_name: '通用旁白声线',
        created_at: '2026-04-28',
        category: 'generic',
        gender: 'female',
        authorized: true,
        requires_disclosure: false,
        usage_label: 'MiniMax 通用旁白声线',
        priority: 10,
      },
    ])

    render(
      <DubbingForm
        onSubmit={onSubmit}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceUsageConfirmed: true,
        }}
      />,
    )

    expect(await screen.findByText('通用旁白声线')).toBeTruthy()
    expect((screen.getByLabelText('目标声线') as HTMLInputElement).value).toBe('')
    expect(screen.getAllByText('女声').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/通用旁白声线/).length).toBeGreaterThan(0)

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false))
    fireEvent.click(submitButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0].voiceId).toBe('')
  })

  it('normalizes provider gate confirmations before restoring and submitting them', async () => {
    const onSubmit = vi.fn<(values: DubbingFormValues) => Promise<void>>(async () => {})
    setupFetch({}, [{ voice_id: 'voice-main', created_at: 'saved' }])

    render(
      <DubbingForm
        onSubmit={onSubmit}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceId: 'voice-main',
          voiceUsageConfirmed: true,
          confirmedGateIds: [' translation_provider ', 'minimax_tts', 'translation_provider', ''],
        }}
        providerConfirmation={{
          requiredGateIds: ['translation_provider', 'minimax_tts', 'translation_provider', ''],
          gates: [
            {
              id: 'translation_provider',
              label: '真实翻译',
              detail: '调用翻译 provider。',
              externalCall: true,
              maySpendMoney: false,
            },
            {
              id: 'minimax_tts',
              label: 'MiniMax TTS',
              detail: '调用 MiniMax TTS。',
              externalCall: true,
              maySpendMoney: true,
            },
          ],
          translationCredentialRuntimeRows: [
            { label: 'Key 来源', value: '环境变量 GOOGLE_AI_STUDIO_API_KEY' },
            { label: '模型', value: 'gemini-env-model（环境变量 GEMINI_MODEL_ID）' },
            {
              label: 'Base URL',
              value: '已配置（环境变量 GOOGLE_AI_STUDIO_API_BASE_URL）',
            },
          ],
          translationCredentialDetail:
            'Gemini 翻译凭证来自环境变量；设置页没有真实 provider 验证记录。',
        }}
      />,
    )

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    const providerGateCheckbox = screen.getByRole('checkbox', {
      name: /已确认真实 provider 调用/,
    }) as HTMLInputElement
    expect(providerGateCheckbox.checked).toBe(true)
    expect(
      screen.getAllByText((content) => content.includes('YouTube 下载必须先走 ingest')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('翻译运行时')).toBeTruthy()
    expect(screen.getByText('gemini-env-model（环境变量 GEMINI_MODEL_ID）')).toBeTruthy()
    expect(screen.getByText('已配置（环境变量 GOOGLE_AI_STUDIO_API_BASE_URL）')).toBeTruthy()
    expect(screen.queryByText((content) => content.includes('sk-api'))).toBeNull()

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false))
    fireEvent.click(submitButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0].confirmedGateIds).toEqual([
      'translation_provider',
      'minimax_tts',
    ])
  })

  it('does not treat authorized voice metadata as per-task usage-boundary acknowledgement', async () => {
    setupFetch({}, [
      {
        voice_id: 'voice-authorized',
        display_name: '已授权声线',
        created_at: '2026-04-28',
        category: 'authorized_clone',
        authorized: true,
        requires_disclosure: false,
        usage_label: '授权克隆声线（本地记录）',
        priority: 10,
      },
    ])

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceId: 'voice-authorized',
          voiceUsageConfirmed: false,
        }}
      />,
    )

    expect(await screen.findByDisplayValue('voice-authorized')).toBeTruthy()
    expect(screen.getByText('等待边界确认')).toBeTruthy()
    expect((screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('invalidates usage-boundary acknowledgement when the primary voice changes', async () => {
    setupFetch({}, [
      { voice_id: 'voice-main', created_at: 'saved' },
      { voice_id: 'voice-next', created_at: 'saved' },
    ])

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceId: 'voice-main',
          voiceUsageConfirmed: true,
        }}
      />,
    )

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: /voice-next/ }))

    const confirmation = screen.getByRole('checkbox', {
      name: /已确认声线使用边界/,
    }) as HTMLInputElement
    expect(confirmation.checked).toBe(false)
    expect(screen.getByText('等待边界确认')).toBeTruthy()
    await waitFor(() => expect(submitButton.disabled).toBe(true))
  })

  it('invalidates usage-boundary acknowledgement when the secondary voice changes', async () => {
    setupFetch({}, [{ voice_id: 'voice-main', created_at: 'saved' }])

    render(
      <DubbingForm
        onSubmit={vi.fn()}
        initialValues={{
          videoUrl: 'C:\\tmp\\source.mp4',
          voiceId: 'voice-main',
          secondaryVoiceId: 'voice-guest-old',
          voiceUsageConfirmed: true,
        }}
      />,
    )

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false))

    fireEvent.change(screen.getByLabelText('第二声线'), {
      target: { value: 'voice-guest-new' },
    })

    const confirmation = screen.getByRole('checkbox', {
      name: /已确认声线使用边界/,
    }) as HTMLInputElement
    expect(confirmation.checked).toBe(false)
    expect(screen.getByText('等待边界确认')).toBeTruthy()
    await waitFor(() => expect(submitButton.disabled).toBe(true))
  })

  it('previews and confirms removing a saved voice from the local voice list', async () => {
    const fetchMock = setupFetch({}, [{ voice_id: 'voice-saved', created_at: '2026-04-26' }])

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByText('voice-saved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /voice-saved/ }))
    expect(screen.getByDisplayValue('voice-saved')).toBeTruthy()
    expect(screen.getByText('已在本地常用声线清单')).toBeTruthy()
    expect(screen.getAllByText('2026-04-26').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /移除声线/ }))

    expect(await screen.findByText('声线已从本地常用清单移除，本次目标声线已清空。')).toBeTruthy()
    expect(screen.getByText('已移除')).toBeTruthy()
    expect(screen.getByText('voice-saved')).toBeTruthy()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'DELETE',
        ),
      ).toBe(true),
    )

    const deleteCall = fetchMock.mock.calls.find(
      ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'DELETE',
    )
    const body = JSON.parse(String(deleteCall?.[1]?.body))
    expect(body).toEqual({ voiceId: 'voice-saved' })
  })

  it('saves the current secondary voice into creator assets', async () => {
    const fetchMock = setupFetch({
      default_voice_id: 'voice-main',
      secondary_voice_id: 'voice-old-guest',
      default_audience: '華語觀眾',
    })

    render(<DubbingForm onSubmit={vi.fn()} />)

    expect(await screen.findByDisplayValue('voice-old-guest')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('第二声线'), {
      target: { value: 'voice-new-guest' },
    })
    expect(screen.getByText('将保存为长期资产')).toBeTruthy()
    expect(screen.getAllByText('voice-new-guest').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /保存受众\/声线为长期资产/ }))

    expect(await screen.findByText('受众、用词和声线已保存为长期资产。')).toBeTruthy()
    expect(screen.getAllByText('第二声线').length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url === '/api/configs/laputa_creator_profile' && options?.method === 'PUT',
        ),
      ).toBe(true)
    })

    const putCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/configs/laputa_creator_profile' && options?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body))
    const savedProfile = JSON.parse(body.value)

    expect(savedProfile.default_voice_id).toBe('voice-main')
    expect(savedProfile.secondary_voice_id).toBe('voice-new-guest')
  })

  it('previews and confirms the project glossary saved from the dubbing form', async () => {
    const fetchMock = setupFetch()

    render(<DubbingForm onSubmit={vi.fn()} />)

    const glossaryField = await screen.findByPlaceholderText(/Lars Vontine/)
    fireEvent.change(glossaryField, {
      target: { value: 'Wave59 -> Wave五十九 # 固定读法\n99年 -> 九九年' },
    })

    expect(screen.getByText('将保存固定读法')).toBeTruthy()
    expect(screen.getAllByText('Wave59 -> Wave五十九 # 固定读法').length).toBeGreaterThan(0)
    expect(screen.getAllByText('99年 -> 九九年').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /保存词库/ }))

    expect(await screen.findByText('词库已保存，下次提交或重跑会自动套用。')).toBeTruthy()
    expect(screen.getByText('固定读法')).toBeTruthy()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url === '/api/configs/dubbing_project_glossary' && options?.method === 'PUT',
        ),
      ).toBe(true),
    )

    const putCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/configs/dubbing_project_glossary' && options?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body))
    expect(body.value).toContain('Wave59 -> Wave五十九')
    expect(body.value).toContain('99年 -> 九九年')
  })
})
