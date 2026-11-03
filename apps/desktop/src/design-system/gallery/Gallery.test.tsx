import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GalleryApp } from './GalleryApp';

afterEach(() => {
  window.location.hash = '';
});

describe('디자인 시스템 견본(gallery.html)', () => {
  it('모든 컴포넌트 묶음을 실제 상태로 늘어놓는다', () => {
    render(<GalleryApp />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Vater 디자인 시스템' }),
    ).toBeInTheDocument();
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups).toEqual([
      '색',
      '글자',
      '간격과 선',
      '숫자 표기',
      '의견 눈금',
      '수신 상태와 시장 상태',
      '버튼',
      '탭',
      '입력과 메뉴',
      '구역과 표',
      '미니 차트',
      '차트',
      '배너와 면책 문구',
      'AI 문장',
      '사이드바와 상태 표시줄',
    ]);
    expect(screen.getAllByText(/예시 데이터/).length).toBeGreaterThan(0);
  });

  it('#shell: 창 틀 견본(사이드바, 본문, 상태 표시줄)', () => {
    window.location.hash = '#shell';
    render(<GalleryApp />);
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '상태' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('#dashboard: 캔버스 위 숫자 줄과 칸 카드(카드 안 카드 없음)', () => {
    window.location.hash = '#dashboard';
    render(<GalleryApp />);
    expect(screen.getAllByRole('group').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole('region', { name: '지수 차트' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '브리핑 요약' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '감시 종목' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '최근 알림' })).toBeInTheDocument();
    for (const region of screen.getAllByRole('region')) {
      expect(region.parentElement?.closest('section')).toBeNull();
    }
  });

  it('#shell-offline: 오프라인 배너가 붙은 창 틀', () => {
    window.location.hash = '#shell-offline';
    render(<GalleryApp />);
    expect(screen.getByRole('status')).toHaveTextContent('오프라인: 알림 감시 일시 중지');
  });
});
