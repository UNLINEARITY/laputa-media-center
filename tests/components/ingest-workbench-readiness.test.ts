import { describe, expect, it } from 'vitest'
import {
  getDeliveryAuditReadinessBadge,
  getProviderGateBlockerLabel,
  getProviderSmokeReadinessBadge,
  getTranslationCredentialRuntimeRows,
  getTranslationReadinessBadge,
  getTtsReadinessBadge,
} from '@/components/ingest/ingest-workbench'

describe('IngestWorkbench readiness badges', () => {
  it('does not label missing Gemini credentials as passthrough unless explicitly allowed', () => {
    expect(
      getTranslationReadinessBadge({
        translation_configured: false,
        passthrough_translation_allowed: false,
      }),
    ).toEqual({ tone: 'blocked', label: '未配置' })

    expect(
      getTranslationReadinessBadge({
        translation_configured: false,
        passthrough_translation_allowed: true,
      }),
    ).toEqual({ tone: 'warning', label: '原文占位' })

    expect(
      getTranslationReadinessBadge({
        translation_configured: true,
        passthrough_translation_allowed: false,
      }),
    ).toEqual({ tone: 'ready', label: '已配置' })

    expect(
      getTranslationReadinessBadge({
        translation_configured: true,
        passthrough_translation_allowed: false,
        translation_credential_status: {
          configured: true,
          verified: true,
          source: 'settings',
          verification_state: 'verified',
          detail: '设置页 Gemini 翻译凭证已通过一次真实 provider 验证。',
        },
      }),
    ).toEqual({ tone: 'ready', label: '已验证' })

    expect(
      getTranslationReadinessBadge({
        translation_configured: true,
        passthrough_translation_allowed: false,
        translation_credential_status: {
          configured: true,
          verified: false,
          source: 'settings',
          verification_state: 'saved_unverified',
          detail: '设置页 Gemini 翻译凭证已加密保存，但尚未执行真实 provider 验证。',
        },
      }),
    ).toEqual({ tone: 'warning', label: '待验证' })

    expect(
      getTranslationReadinessBadge({
        translation_configured: true,
        passthrough_translation_allowed: false,
        translation_credential_status: {
          configured: true,
          verified: false,
          source: 'env',
          verification_state: 'not_tracked',
          detail: 'Gemini 翻译凭证来自环境变量；设置页没有真实 provider 验证记录。',
        },
      }),
    ).toEqual({ tone: 'warning', label: '未记录验证' })
  })

  it('only labels missing MiniMax as placeholder when placeholder TTS is allowed', () => {
    expect(
      getTtsReadinessBadge({
        tts_configured: true,
        placeholder_tts_allowed: false,
        tts_credential_status: {
          configured: true,
          verified: true,
          source: 'settings',
          verification_state: 'verified',
          detail: '设置页 MiniMax 凭证已通过一次付费 TTS 验证。',
        },
      }),
    ).toEqual({ tone: 'ready', label: '已验证' })

    expect(
      getTtsReadinessBadge({
        tts_configured: true,
        placeholder_tts_allowed: false,
        tts_credential_status: {
          configured: true,
          verified: false,
          source: 'settings',
          verification_state: 'saved_unverified',
          detail: '设置页 MiniMax 凭证已加密保存，但尚未执行付费 TTS 验证。',
        },
      }),
    ).toEqual({ tone: 'warning', label: '待验证' })

    expect(
      getTtsReadinessBadge({
        tts_configured: true,
        placeholder_tts_allowed: false,
        tts_credential_status: {
          configured: true,
          verified: false,
          source: 'env',
          verification_state: 'not_tracked',
          detail: 'MiniMax 凭证来自环境变量或本地文件；设置页没有付费验证记录。',
        },
      }),
    ).toEqual({ tone: 'warning', label: '未记录验证' })

    expect(
      getTtsReadinessBadge({
        tts_configured: false,
        placeholder_tts_allowed: false,
      }),
    ).toEqual({ tone: 'blocked', label: '未配置' })

    expect(
      getTtsReadinessBadge({
        tts_configured: false,
        placeholder_tts_allowed: true,
      }),
    ).toEqual({ tone: 'warning', label: '静音占位' })
  })

  it('labels provider smoke as confirmation, dry-run, or blocked from the gate aggregate', () => {
    expect(
      getProviderSmokeReadinessBadge({
        dry_run_ready: true,
        provider_smoke_ready: true,
        provider_smoke_requires_confirmation: true,
      }),
    ).toEqual({ tone: 'warning', label: '需确认' })

    expect(
      getProviderSmokeReadinessBadge({
        dry_run_ready: true,
        provider_smoke_ready: false,
        provider_smoke_requires_confirmation: false,
      }),
    ).toEqual({ tone: 'warning', label: '仅 dry-run' })

    expect(
      getProviderSmokeReadinessBadge({
        dry_run_ready: false,
        provider_smoke_ready: false,
        provider_smoke_requires_confirmation: false,
      }),
    ).toEqual({ tone: 'blocked', label: '未就绪' })
  })

  it('labels delivery audit separately from runtime provider readiness', () => {
    expect(
      getDeliveryAuditReadinessBadge({
        delivery_audit_ready: true,
        delivery_audit: {
          ready: true,
          status: 'ready',
          label: '交付审计就绪',
          guidance: 'ok',
          missing: [],
        },
      }),
    ).toEqual({ tone: 'ready', label: '审计就绪' })

    expect(
      getDeliveryAuditReadinessBadge({
        delivery_audit_ready: false,
        delivery_audit: {
          ready: false,
          status: 'warning',
          label: '可跑，待审计',
          guidance: '声线用途或披露元数据不完整',
          missing: ['声线用途/披露元数据'],
        },
      }),
    ).toEqual({ tone: 'warning', label: '可跑，待审计' })
  })

  it('labels optional provider gate blockers as skip reasons', () => {
    expect(getProviderGateBlockerLabel({ run_mode: 'optional_skip' })).toBe('跳过原因')
    expect(getProviderGateBlockerLabel({ run_mode: 'blocked' })).toBe('阻断')
  })

  it('summarizes Gemini runtime key, model, and base-url sources without secrets', () => {
    expect(
      getTranslationCredentialRuntimeRows({
        configured: true,
        verified: false,
        source: 'env',
        verification_state: 'not_tracked',
        detail: 'Gemini 翻译凭证来自环境变量；设置页没有真实 provider 验证记录。',
        runtime: {
          provider: 'gemini',
          api_key_source: 'env:GOOGLE_AI_STUDIO_API_KEY',
          model_id: 'gemini-env-model',
          model_source: 'env:GEMINI_MODEL_ID',
          api_base_url_configured: true,
          api_base_url_source: 'env:GOOGLE_AI_STUDIO_API_BASE_URL',
        },
      }),
    ).toEqual([
      { label: 'Key 来源', value: '环境变量 GOOGLE_AI_STUDIO_API_KEY' },
      { label: '模型', value: 'gemini-env-model（环境变量 GEMINI_MODEL_ID）' },
      { label: 'Base URL', value: '已配置（环境变量 GOOGLE_AI_STUDIO_API_BASE_URL）' },
    ])

    expect(
      JSON.stringify(
        getTranslationCredentialRuntimeRows({
          configured: true,
          verified: true,
          source: 'settings',
          verification_state: 'verified',
          detail: '设置页 Gemini 翻译凭证已通过一次真实 provider 验证。',
          runtime: {
            provider: 'gemini',
            api_key_source: 'settings:google_ai_studio',
            model_id: 'gemini-settings-model',
            model_source: 'settings:google_ai_studio.model_id',
            api_base_url_configured: false,
            api_base_url_source: null,
          },
        }),
      ),
    ).not.toContain('sk-')
  })
})
