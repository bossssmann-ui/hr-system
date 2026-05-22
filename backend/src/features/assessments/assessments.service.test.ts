import { describe, expect, test } from 'bun:test'

import { buildInterviewQuestionInput } from './assessments.service'

describe('assessments.service', () => {
  test('buildInterviewQuestionInput strips contact PII from LLM payload', () => {
    const input = buildInterviewQuestionInput(
      {
        candidate: {
          location: 'Moscow',
          externalIds: {
            hh_resume_snapshot: {
              title: 'Engineer',
              experience: ['Acme'],
              email: 'private@example.com',
              phone: '+70000000000',
              full_name: 'Hidden Name',
            },
          },
        },
        vacancy: {
          title: 'Backend Engineer',
          description: 'TypeScript APIs',
          requisition: {
            grade: 'M3',
          },
        },
      },
      {
        email: 'another@example.com',
        phone: '+79990001122',
        full_name: 'Another Name',
        skills: ['TypeScript'],
      },
    )

    const serialized = JSON.stringify(input)
    expect(serialized).not.toContain('private@example.com')
    expect(serialized).not.toContain('another@example.com')
    expect(serialized).not.toContain('+70000000000')
    expect(serialized).not.toContain('Hidden Name')
  })
})
