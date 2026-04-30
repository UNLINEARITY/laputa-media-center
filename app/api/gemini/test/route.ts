export const dynamic = 'force-dynamic'
export const revalidate = 0

import { GoogleGenAI } from '@google/genai'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SAFETY_SETTINGS } from '@/lib/ai/gemini/constants/safety-settings'
import { parseServiceAccountJson } from '@/lib/ai/gemini-utils'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  buildPaidDynamicTestsRequiredError,
  isPaidDynamicTestsAllowed,
} from '@/lib/provider-call-policy'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'

const vertexSchema = z.object({
  platform: z.literal('vertex'),
  project_id: z.string().min(1, 'Project ID 不能为空'),
  location: z.string().optional(),
  model_id: z.string().min(1, 'Model ID 不能为空'),
  service_account_json: z.string().min(1, 'Service Account JSON 不能为空'),
  prompt: z.string().optional(),
  confirmPaidVerification: z.boolean().optional(),
  confirm_paid_verification: z.boolean().optional(),
})

const aiStudioSchema = z.object({
  platform: z.literal('ai-studio'),
  api_key: z.string().min(1, 'API Key 不能为空'),
  model_id: z.string().min(1, 'Model ID 不能为空'),
  api_base_url: z.string().optional(),
  prompt: z.string().optional(),
  confirmPaidVerification: z.boolean().optional(),
  confirm_paid_verification: z.boolean().optional(),
})

const requestSchema = z.discriminatedUnion('platform', [vertexSchema, aiStudioSchema])

const DEFAULT_PROMPT = '你好，请简单介绍一下你的能力。'

function hasConfirmedPaidVerification(data: z.infer<typeof requestSchema>) {
  return data.confirmPaidVerification === true || data.confirm_paid_verification === true
}

const normalizeLocation = (location?: string) => {
  const normalized = (location || '').trim().toLowerCase()
  if (!normalized) return 'us-central1'
  if (normalized === 'global') return 'global'
  return normalized
}

const normalizeModelId = (modelId: string) => modelId.replace(/^models\//, '')

function normalizeGeminiApiBaseUrl(value?: string): string {
  const trimmed = (value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://generativelanguage.googleapis.com/v1beta'
  if (trimmed.endsWith('/models')) return trimmed.slice(0, -'/models'.length)
  return trimmed
}

function isOpenAICompatibleApiBaseUrl(value?: string): boolean {
  const trimmed = (value || '').trim()
  if (!trimmed) return false

  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '').toLowerCase()
    if (url.hostname.toLowerCase() === 'x666.me') return true
    if (path.endsWith('/chat/completions')) return true
    return (path === '/v1' || path.endsWith('/v1')) && !path.includes('/v1beta')
  } catch {
    const lower = trimmed.toLowerCase()
    return lower.includes('/v1') && !lower.includes('/v1beta')
  }
}

function normalizeOpenAICompatibleBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '')
    if (path.endsWith('/chat/completions')) {
      url.pathname = path.slice(0, -'/chat/completions'.length) || '/'
      return url.toString().replace(/\/+$/, '')
    }
    if (!path || path === '/') {
      url.pathname = '/v1'
      return url.toString().replace(/\/+$/, '')
    }
  } catch {
    // Fall through to raw normalization.
  }

  return trimmed
}

function buildOpenAIChatCompletionsUrl(apiBaseUrl: string): string {
  return `${normalizeOpenAICompatibleBaseUrl(apiBaseUrl)}/chat/completions`
}

function buildGenerateContentUrl(apiBaseUrl: string | undefined, modelId: string): string {
  const baseUrl = normalizeGeminiApiBaseUrl(apiBaseUrl)
  return `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`
}

function extractTextFromGenerateContentResponse(data: unknown): string {
  const candidates = (
    data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  ).candidates
  return candidates?.[0]?.content?.parts?.[0]?.text || ''
}

function extractTextFromOpenAIResponse(data: unknown): string {
  const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices
  return choices?.[0]?.message?.content || ''
}

export async function POST(req: NextRequest) {
  try {
    // 统一认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    // Token 认证：检查速率限制（测试接口）
    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:test`, RATE_LIMIT_PRESETS.TEST)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const body = await req.json()
    const data = requestSchema.parse(body)

    if (!hasConfirmedPaidVerification(data)) {
      return NextResponse.json(
        {
          error: 'Paid verification confirmation required',
          message: 'Gemini 测试会调用真实 provider；请先明确确认可能产生费用或外部请求。',
        },
        { status: 400 },
      )
    }

    if (!isPaidDynamicTestsAllowed()) {
      return NextResponse.json(
        buildPaidDynamicTestsRequiredError(
          'Gemini 测试会调用真实 provider；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。',
        ),
        { status: 400 },
      )
    }

    if (data.platform === 'vertex') {
      return await testVertexAI(data)
    }
    return await testAIStudio(data)
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: '参数校验失败', details: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      {
        error: '测试调用失败',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

async function testVertexAI(data: z.infer<typeof vertexSchema>) {
  const location = normalizeLocation(data.location)
  const modelId = normalizeModelId(data.model_id)
  const prompt = (data.prompt || DEFAULT_PROMPT).trim() || DEFAULT_PROMPT

  // 解析 Service Account JSON
  const serviceAccount = parseServiceAccountJson(data.service_account_json)

  // 使用新 SDK 创建 Vertex AI 客户端
  const ai = new GoogleGenAI({
    vertexai: true,
    project: data.project_id,
    location,
    googleAuthOptions: {
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    },
  })

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 512,
        safetySettings: SAFETY_SETTINGS,
      },
    })

    return NextResponse.json({
      text: response.text || '',
      raw: response,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: '测试调用失败',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

async function testAIStudio(data: z.infer<typeof aiStudioSchema>) {
  const modelId = normalizeModelId(data.model_id)
  const prompt = (data.prompt || DEFAULT_PROMPT).trim() || DEFAULT_PROMPT
  const apiBaseUrl = data.api_base_url?.trim()

  try {
    if (apiBaseUrl) {
      if (isOpenAICompatibleApiBaseUrl(apiBaseUrl)) {
        const response = await fetch(buildOpenAIChatCompletionsUrl(apiBaseUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.api_key}`,
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2048,
          }),
        })

        const raw = await response.json().catch(async () => ({ error: await response.text() }))
        if (!response.ok) {
          return NextResponse.json(
            {
              error: '测试调用失败',
              message: JSON.stringify(raw),
            },
            { status: response.status },
          )
        }

        return NextResponse.json({
          text: extractTextFromOpenAIResponse(raw),
          raw,
        })
      }

      const response = await fetch(buildGenerateContentUrl(apiBaseUrl, modelId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': data.api_key,
          Authorization: `Bearer ${data.api_key}`,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            maxOutputTokens: 2048,
          },
        }),
      })

      const raw = await response.json().catch(async () => ({ error: await response.text() }))
      if (!response.ok) {
        return NextResponse.json(
          {
            error: '测试调用失败',
            message: JSON.stringify(raw),
          },
          { status: response.status },
        )
      }

      return NextResponse.json({
        text: extractTextFromGenerateContentResponse(raw),
        raw,
      })
    }

    // 使用新 SDK 创建 AI Studio 客户端
    const ai = new GoogleGenAI({ apiKey: data.api_key })
    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 2048,
        safetySettings: SAFETY_SETTINGS,
      },
    })

    // 检查是否有响应文本
    if (!response.text) {
      // 检查是否被安全过滤器阻止
      const candidates = (response as { candidates?: Array<{ finishReason?: string }> }).candidates
      if (candidates?.[0]?.finishReason) {
        const finishReason = candidates[0].finishReason
        if (finishReason !== 'STOP') {
          return NextResponse.json({
            text: '',
            error: `内容生成被阻止：${finishReason}`,
            raw: response,
          })
        }
      }
    }

    return NextResponse.json({
      text: response.text || '',
      raw: response,
    })
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    // 检测 429 配额错误
    if (
      errorMsg.includes('429') ||
      errorMsg.includes('RESOURCE_EXHAUSTED') ||
      errorMsg.includes('quota')
    ) {
      return NextResponse.json(
        {
          error:
            'Gemini 免费层配额已用尽，或当前模型需要付费层级；免费层请使用 gemini-2.5-flash-lite 或 gemini-2.5-flash。',
          message: errorMsg,
        },
        { status: 429 },
      )
    }
    return NextResponse.json(
      {
        error: '测试调用失败',
        message: errorMsg,
      },
      { status: 500 },
    )
  }
}
