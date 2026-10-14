/** 도움말 > 사용 안내 대화상자: 문서 전체(목차 + 본문)를 보이고, 목차 클릭이 절을 가리키며, 안내 카드의 "자세히" 가 연다. */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GuideDialog } from '@editor/features/onboarding/GuideDialog';
import { OnboardingCard } from '@editor/features/onboarding/OnboardingCard';
import { useOnboarding } from '@editor/features/onboarding/store';
import { usageDoc } from '@editor/features/onboarding/usage-doc';
import { resetStores } from '../../stores';

beforeEach(resetStores);

describe('GuideDialog', () => {
  it('닫혀 있으면 아무것도 그리지 않는다', () => {
    render(<GuideDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('열리면 목차와 문서 본문(제목·표·목록)을 보이고 목차 클릭이 현재 절을 바꾼다', () => {
    useOnboarding.getState().setGuideOpen(true);
    render(<GuideDialog />);
    const dialog = screen.getByRole('dialog', { name: '사용 안내' });
    const toc = within(dialog).getByRole('navigation', { name: '목차' });
    const { toc: entries } = usageDoc();
    expect(within(toc).getAllByRole('button')).toHaveLength(entries.length);
    expect(within(dialog).getByRole('heading', { level: 1, name: 'SH Video Editor 사용법' })).toBeTruthy();
    expect(within(dialog).getAllByRole('table').length).toBeGreaterThanOrEqual(3);
    // HTML 삽입이 아니라 요소로 그린다
    expect(dialog.querySelector('[dangerouslysetinnerhtml]')).toBeNull();

    const target = within(toc).getByRole('button', { name: '4. 단축키' });
    fireEvent.click(target);
    expect(target.getAttribute('aria-current')).toBe('location');
    const heading = within(dialog).getByRole('heading', { level: 2, name: '4. 단축키' });
    expect(heading.id).toBe(entries.find((e) => e.text === '4. 단축키')?.id);

    fireEvent.click(within(dialog).getByRole('button', { name: '확인' }));
    expect(useOnboarding.getState().guideOpen).toBe(false);
  });

  it('Esc 로 닫힌다', () => {
    useOnboarding.getState().setGuideOpen(true);
    render(<GuideDialog />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useOnboarding.getState().guideOpen).toBe(false);
  });
});

describe('OnboardingCard 자세히', () => {
  it('안내 카드의 자세히 버튼이 사용 안내 대화상자를 연다', () => {
    render(
      <>
        <OnboardingCard variant="timeline" />
        <GuideDialog />
      </>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '자세히' }));
    expect(screen.getByRole('dialog', { name: '사용 안내' })).toBeTruthy();
  });
});
