import { Card } from '../../design-system';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { AnalysisHistory } from './AnalysisHistory';
import { NewAnalysisForm } from './NewAnalysisForm';

/** 분석(#/analyses): 새 분석과 이력. 결과·진행은 #/analyses/:id. */
export function AnalysesScreen() {
  return (
    <>
      <ScreenHeader
        title="분석"
        lede="여러 AI 에이전트가 토론해 의견을 냅니다. 판단은 직접 하세요. 한 건에 수 분에서 수십 분 걸립니다."
      />
      <div className={common.stack}>
        <Card title="새 분석">
          <NewAnalysisForm />
        </Card>
        <AnalysisHistory />
      </div>
    </>
  );
}
