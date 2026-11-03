import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';

function Market({ onValueChange }: { onValueChange?: (v: string) => void }) {
  return (
    <Tabs defaultValue="kr" onValueChange={onValueChange}>
      <TabList label="시장">
        <Tab value="kr">국내</Tab>
        <Tab value="us">미국</Tab>
        <Tab value="all">전체</Tab>
      </TabList>
      <TabPanel value="kr">코스피 2,583.27</TabPanel>
      <TabPanel value="us">S&amp;P 500 5,712.20</TabPanel>
      <TabPanel value="all">전체 목록</TabPanel>
    </Tabs>
  );
}

describe('Tabs (WAI-ARIA 탭 패턴)', () => {
  it('tablist 이름, 선택된 탭, 연결된 패널', () => {
    render(<Market />);
    expect(screen.getByRole('tablist', { name: '시장' })).toBeInTheDocument();
    const kr = screen.getByRole('tab', { name: '국내' });
    expect(kr).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '미국' })).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel', { name: '국내' });
    expect(panel).toHaveTextContent('코스피 2,583.27');
    expect(kr).toHaveAttribute('aria-controls', panel.id);
    expect(screen.queryByText('전체 목록')).not.toBeInTheDocument();
  });

  it('선택된 탭만 Tab 키로 들어간다(나머지는 tabIndex -1)', () => {
    render(<Market />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('클릭하면 바뀌고 onValueChange를 부른다', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Market onValueChange={onValueChange} />);
    await user.click(screen.getByRole('tab', { name: '미국' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('S&P 500 5,712.20');
    expect(onValueChange).toHaveBeenCalledWith('us');
  });

  it('←→로 옮기며 바로 선택하고, 끝에서 처음으로 돈다. Home·End', async () => {
    const user = userEvent.setup();
    render(<Market />);
    await user.click(screen.getByRole('tab', { name: '국내' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '미국' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: '미국' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('tab', { name: '국내' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: '전체' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: '국내' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '전체' })).toHaveAttribute('aria-selected', 'true');
  });

  it('제어 모드: value를 바깥에서 정한다', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState('us');
      return (
        <Tabs value={value} onValueChange={setValue}>
          <TabList label="시장" variant="segment">
            <Tab value="kr">국내</Tab>
            <Tab value="us">미국</Tab>
          </TabList>
          <TabPanel value="kr">국내 패널</TabPanel>
          <TabPanel value="us">미국 패널</TabPanel>
        </Tabs>
      );
    }
    render(<Controlled />);
    expect(screen.getByRole('tablist')).toHaveAttribute('data-variant', 'segment');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('미국 패널');
    await user.click(screen.getByRole('tab', { name: '국내' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('국내 패널');
  });

  it('탭 목록과 패널을 떨어진 자리에 둘 수 있다(구역 머리의 세그먼트 + 아래 본문)', () => {
    render(
      <Tabs defaultValue="kr">
        <header>
          <TabList label="시장" variant="segment">
            <Tab value="kr">국내</Tab>
            <Tab value="us">미국</Tab>
          </TabList>
        </header>
        <div>
          <TabPanel value="kr">국내 브리핑</TabPanel>
          <TabPanel value="us">미국 브리핑</TabPanel>
        </div>
      </Tabs>,
    );
    expect(screen.getByRole('tabpanel', { name: '국내' })).toHaveTextContent('국내 브리핑');
  });
});
