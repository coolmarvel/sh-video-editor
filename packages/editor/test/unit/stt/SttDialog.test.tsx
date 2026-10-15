/**
 * features/stt/SttDialog.tsx 동의 대화상자: 모델이 놓이는 곳 문구가 호스트에 따라 다르다. 목록의 `dir` 이 null 이면
 * 브라우저 저장소(웹), 경로가 있으면 앱 데이터 폴더(데스크톱).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SttDialog } from '@editor/features/stt/SttDialog';
import { useStt } from '@editor/features/stt/store';
import type { SpeechModel } from '@editor/features/stt/rules';
import { resetStores } from '../../stores';

const base: SpeechModel = {
  id: 'whisper-base',
  name: 'Whisper base',
  multilingual: true,
  description: 'default',
  license: 'MIT',
  source: 'https://huggingface.co/openai/whisper-base',
  size: 292_000_000,
  installed: false,
};

function consent(dir: string | null) {
  useStt.setState({ phase: 'consent', pendingModel: base, catalog: { available: true, default: base.id, dir, models: [base] } });
}

beforeEach(() => {
  resetStores();
  useStt.setState(useStt.getInitialState(), true);
});

describe('SttDialog 동의', () => {
  it('웹(dir 없음)은 브라우저 사이트 저장소에 보관한다고 알린다', () => {
    consent(null);
    render(<SttDialog />);
    expect(screen.getByTestId('stt-consent').textContent).toMatch(/사이트 저장소/);
  });

  it('데스크톱은 앱 데이터 폴더', () => {
    consent('/data/models');
    render(<SttDialog />);
    const text = screen.getByTestId('stt-consent').textContent ?? '';
    expect(text).toMatch(/앱 데이터 폴더/);
    expect(text).not.toMatch(/사이트 저장소/);
  });
});
