import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrokerBar } from './BrokerBar';
import { BrokerChip } from './BrokerChip';

const shares = [
  { id: 'kis', name: '한투', color: '#7B634F', ratio: 2 / 3 },
  { id: 'meritz', name: '메리츠', color: '#D14C34', ratio: 1 / 3 },
];

describe('BrokerBar', () => {
  it('칸 수와 너비 비율, 읽기 이름', () => {
    const { container } = render(<BrokerBar shares={shares} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName('증권사별 비중: 한투 66.7%, 메리츠 33.3%');
    const cells = container.querySelectorAll('[data-broker]');
    expect(cells).toHaveLength(2);
    expect((cells[0] as HTMLElement).style.flexGrow).toBe(String(2 / 3));
  });

  it('비율이 0인 증권사는 칸을 그리지 않는다', () => {
    const { container } = render(
      <BrokerBar shares={[...shares, { id: 'x', name: '키움', color: '#D4467D', ratio: 0 }]} />,
    );
    expect(container.querySelectorAll('[data-broker]')).toHaveLength(2);
  });
});

describe('BrokerChip', () => {
  it('점은 장식이고 글자는 잉크색 이름과 값', () => {
    const { container } = render(
      <BrokerChip id="kis" color="#7B634F">
        한투 10주
      </BrokerChip>,
    );
    expect(screen.getByText('한투 10주')).toBeInTheDocument();
    expect(container.querySelector('[data-dot]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('내장 증권사는 토큰 색, 직접 추가한 증권사는 받은 색을 쓴다', () => {
    const { container, rerender } = render(
      <BrokerChip id="kis" color="#000000">
        a
      </BrokerChip>,
    );
    expect(
      (container.querySelector('[data-dot]') as HTMLElement).style.getPropertyValue(
        '--broker-color',
      ),
    ).toBe('var(--color-broker-kis)');
    rerender(
      <BrokerChip id="custom-1" color="#2E8B57">
        a
      </BrokerChip>,
    );
    expect(
      (container.querySelector('[data-dot]') as HTMLElement).style.getPropertyValue(
        '--broker-color',
      ),
    ).toBe('#2E8B57');
  });
});
