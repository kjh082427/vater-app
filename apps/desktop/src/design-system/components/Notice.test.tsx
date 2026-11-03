import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiText } from './AiText';
import { Banner } from './Banner';
import { Button } from './Button';
import { Disclaimer } from './Disclaimer';

describe('Banner', () => {
  it('주의(오프라인·오류·끊김): role="alert", 제목과 설명, 행동 버튼', () => {
    render(
      <Banner
        tone="caution"
        title="오프라인: 알림 감시 일시 중지"
        action={<Button size="sm">지금 다시 확인</Button>}
      >
        30초마다 다시 확인합니다. 마지막 수신 14:32:05
      </Banner>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-tone', 'caution');
    expect(alert).toHaveTextContent('오프라인: 알림 감시 일시 중지');
    expect(alert).toHaveTextContent('30초마다 다시 확인합니다. 마지막 수신 14:32:05');
    expect(screen.getByRole('button', { name: '지금 다시 확인' })).toBeInTheDocument();
  });

  it('안내: role="status"', () => {
    render(<Banner tone="info" title="Vater는 트레이에서 계속 실행됩니다" />);
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'info');
  });
});

describe('Disclaimer: 반드시 보여야 하는 문구(스펙)', () => {
  it('기본: 투자 판단 보조용이며 투자 권유가 아닙니다.', () => {
    const { container } = render(<Disclaimer />);
    expect(container.firstElementChild).toHaveTextContent(
      /^투자 판단 보조용이며 투자 권유가 아닙니다\.$/,
    );
  });

  it('분석 결과: 모델과 실행에 따라 결론이 달라질 수 있습니다.', () => {
    const { container } = render(<Disclaimer analysis />);
    expect(container.firstElementChild).toHaveTextContent(
      '투자 판단 보조용이며 투자 권유가 아닙니다. 모델과 실행에 따라 결론이 달라질 수 있습니다.',
    );
  });

  it('덧붙일 문장을 뒤에 이어 쓴다', () => {
    const { container } = render(<Disclaimer>Vater는 주문 기능이 없습니다.</Disclaimer>);
    expect(container.firstElementChild).toHaveTextContent(
      '투자 판단 보조용이며 투자 권유가 아닙니다. Vater는 주문 기능이 없습니다.',
    );
  });
});

describe('AiText: AI가 쓴 문장만 명조로', () => {
  it('AI 문장임을 표시하고(data-voice="ai") 기본은 문단', () => {
    const { container } = render(<AiText>외국인 매수가 대형 반도체주에 몰렸습니다.</AiText>);
    const el = container.firstElementChild;
    expect(el?.tagName).toBe('P');
    expect(el).toHaveAttribute('data-voice', 'ai');
    expect(el).toHaveAttribute('data-size', 'body');
  });

  it('첫 문장(lead) 크기와 다른 요소', () => {
    const { container } = render(
      <AiText as="div" size="lead">
        반도체 대형주가 지수를 끌어올렸습니다.
      </AiText>,
    );
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(container.firstElementChild).toHaveAttribute('data-size', 'lead');
  });

  it('출처 꼬리표("AI 해석")를 붙이면 고딕으로, 문장 뒤에', () => {
    render(<AiText attribution="AI 해석">개인은 차익 실현에 나섰습니다.</AiText>);
    const tag = screen.getByText('AI 해석');
    expect(tag).toHaveAttribute('data-attribution');
    expect(tag.parentElement).toHaveTextContent('개인은 차익 실현에 나섰습니다. AI 해석');
  });
});
