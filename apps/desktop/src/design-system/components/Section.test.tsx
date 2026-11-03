import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Section } from './Section';

describe('Section: 굵은 먹선으로 나눈 구역', () => {
  it('제목으로 이름 붙은 구역(region)과 제목(h2), 보조 정보, 행동', () => {
    render(
      <Section title="감시 종목" meta="5종목" actions={<Button variant="quiet">종목 추가</Button>}>
        <p>본문</p>
      </Section>,
    );
    const region = screen.getByRole('region', { name: '감시 종목' });
    expect(screen.getByRole('heading', { level: 2, name: '감시 종목' })).toBeInTheDocument();
    expect(region).toHaveTextContent('5종목');
    expect(screen.getByRole('button', { name: '종목 추가' })).toBeInTheDocument();
    expect(region).toHaveTextContent('본문');
  });

  it('제목 단계를 바꿀 수 있다', () => {
    render(
      <Section title="강세 측 의견" headingLevel={3}>
        본문
      </Section>,
    );
    expect(screen.getByRole('heading', { level: 3, name: '강세 측 의견' })).toBeInTheDocument();
  });

  it('보조 정보와 행동이 없어도 된다', () => {
    render(<Section title="최근 알림">목록</Section>);
    expect(screen.getByRole('region', { name: '최근 알림' })).toHaveTextContent('목록');
  });
});
