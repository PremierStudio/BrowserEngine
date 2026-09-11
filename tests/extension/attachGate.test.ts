import { describe, expect, it } from 'vitest'
import { decideAttach } from '../../src/extension/attachGate.js'
import { DEFAULT_SETTINGS, type EngineSettings } from '../../src/extension/settings.js'

function settings(patch: Partial<EngineSettings>): EngineSettings {
  return { ...DEFAULT_SETTINGS, ...patch }
}

describe('decideAttach', () => {
  it('denies when the kill switch is on', () => {
    expect(
      decideAttach(settings({ paused: true, attachPolicy: 'always' }), 'https://a.example'),
    ).toBe('deny')
  })

  it('always attaches when policy is always and not paused', () => {
    expect(decideAttach(settings({ attachPolicy: 'always' }), 'https://a.example')).toBe('allow')
    expect(decideAttach(settings({ attachPolicy: 'always' }), undefined)).toBe('allow')
  })

  it('prompts on every host when policy is prompt', () => {
    expect(
      decideAttach(
        settings({ attachPolicy: 'prompt', allowedOrigins: ['https://a.example'] }),
        'https://a.example',
      ),
    ).toBe('prompt')
  })

  it('allows listed origins and prompts on new ones under allowlist', () => {
    const listed = settings({
      attachPolicy: 'allowlist',
      allowedOrigins: ['https://teams.cloud.microsoft'],
    })
    expect(decideAttach(listed, 'https://teams.cloud.microsoft')).toBe('allow')
    expect(decideAttach(listed, 'https://evil.example')).toBe('prompt')
    expect(decideAttach(listed, undefined)).toBe('prompt')
  })

  it('prompts for a missing origin even when the allow-list matches everything', () => {
    const wideOpen = settings({ attachPolicy: 'allowlist', allowedOrigins: ['*'] })
    expect(decideAttach(wideOpen, undefined)).toBe('prompt')
    expect(decideAttach(wideOpen, 'https://a.example')).toBe('allow')
  })
})
