import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { Banner } from './Banner';
import { MarketState } from './MarketState';
import { SidebarNav, type NavItem } from './SidebarNav';
import { StatusBar, StatusBarItem } from './StatusBar';

const items: NavItem[] = [
  { id: 'home', label: '홈', icon: 'home', href: '#/home' },
  { id: 'analysis', label: '분석', icon: 'analysis', href: '#/analysis' },
  {
    id: 'alerts',
    label: '감시·알림',
    icon: 'alerts',
    href: '#/alerts',
    badge: { text: '새 2', label: '새 알림 2건' },
  },
  { id: 'briefing', label: '브리핑', icon: 'briefing', href: '#/briefing' },
  { id: 'settings', label: '설정', icon: 'settings', href: '#/settings' },
];

describe('SidebarNav (스펙 9-1: 홈 · 분석 · 감시·알림 · 브리핑 · 설정)', () => {
  it('"주 메뉴" 내비게이션, 워드마크, 링크 5개', () => {
    render(<SidebarNav items={items} currentId="home" />);
    const nav = screen.getByRole('navigation', { name: '주 메뉴' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    expect(screen.getByText('Vater')).toBeInTheDocument();
  });

  it('현재 화면만 aria-current="page"', () => {
    render(<SidebarNav items={items} currentId="briefing" />);
    expect(screen.getByRole('link', { name: '브리핑' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '홈' })).not.toHaveAttribute('aria-current');
  });

  it('배지: 화면에는 "새 2", 읽을 때는 "새 알림 2건"', () => {
    render(<SidebarNav items={items} currentId="home" />);
    expect(screen.getByRole('link', { name: '감시·알림, 새 알림 2건' })).toBeInTheDocument();
    expect(screen.getByText('새 2')).toHaveAttribute('aria-hidden', 'true');
  });

  it('onNavigate가 있으면 링크 이동 대신 부른다', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<SidebarNav items={items} currentId="home" onNavigate={onNavigate} />);
    await user.click(screen.getByRole('link', { name: '분석' }));
    expect(onNavigate).toHaveBeenCalledWith('analysis');
  });

  it('아래쪽(감시 상태, 서버) 자리', () => {
    render(<SidebarNav items={items} currentId="home" footer={<p>한투 실전 서버에 연결됨</p>} />);
    expect(screen.getByText('한투 실전 서버에 연결됨')).toBeInTheDocument();
  });
});

describe('StatusBar (스펙 9-1: 시장 상태, 한투 연결, AI 엔진)', () => {
  it('"상태"라는 이름의 contentinfo, 항목마다 점과 굵은 이름', () => {
    render(
      <StatusBar>
        <StatusBarItem>
          <MarketState market="KR" status="open" detail="15:30 마감" variant="inline" />
        </StatusBarItem>
        <StatusBarItem tone="caution" label="한투 연결" detail="실시간 2 · 폴링 1" />
        <StatusBarItem align="end">알림 감시 중</StatusBarItem>
      </StatusBar>,
    );
    const bar = screen.getByRole('contentinfo', { name: '상태' });
    expect(bar).toHaveTextContent('국내 장중 15:30 마감');
    expect(bar).toHaveTextContent('한투 연결 실시간 2 · 폴링 1');
    expect(
      screen.getByText('한투 연결').closest('[data-item]')?.querySelector('[data-dot]'),
    ).toHaveAttribute('data-dot', 'caution');
    expect(screen.getByText('알림 감시 중').closest('[data-item]')).toHaveAttribute(
      'data-align',
      'end',
    );
  });
});

describe('AppShell: 사이드바 + 본문 + 상태 표시줄', () => {
  it('본문(main) 앞에 배너, 본문으로 건너뛰기 링크', () => {
    render(
      <AppShell
        sidebar={<SidebarNav items={items} currentId="home" />}
        statusBar={
          <StatusBar>
            <StatusBarItem label="AI 엔진" tone="on" detail="클라우드 전용" />
          </StatusBar>
        }
        banner={<Banner tone="caution" title="오프라인: 알림 감시 일시 중지" />}
      >
        <h1>홈</h1>
      </AppShell>,
    );
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { name: '홈' })).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '상태' })).toBeInTheDocument();
    const skip = screen.getByRole('link', { name: '본문으로 건너뛰기' });
    expect(skip).toHaveAttribute('href', `#${main.id}`);
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('본문으로 건너뛰기는 주소(#)를 바꾸지 않고 본문에 포커스를 옮긴다(해시 라우터와 부딪히지 않게)', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/home';
    render(
      <AppShell
        sidebar={<SidebarNav items={items} currentId="home" />}
        statusBar={<StatusBar>{null}</StatusBar>}
      >
        <h1>홈</h1>
      </AppShell>,
    );
    await user.click(screen.getByRole('link', { name: '본문으로 건너뛰기' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/home');
    window.location.hash = '';
  });
});
