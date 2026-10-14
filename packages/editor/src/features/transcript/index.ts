/**
 * features/transcript: 전사 패널(텍스트 기반 편집, M3-7). 모듈을 읽는 것만으로 인스펙터 탭 "전사" 를 등록한다
 * (레지스트리 방식: features/inspector). 편집본이 있으면 항상 보인다. App.tsx 가 한 번 import 한다.
 */
import { registerInspectorTab } from '../inspector/registry';
import { TranscriptTab } from './TranscriptTab';

registerInspectorTab({ id: 'transcript', label: '전사', order: 95, when: () => true, component: TranscriptTab });

export { TranscriptTab, clock } from './TranscriptTab';
export { useTranscript, selectedRanges, hitParagraphs } from './store';
export type { Paragraph, SearchHit, TranscriptState } from './store';
