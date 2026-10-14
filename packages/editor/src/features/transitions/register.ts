/** 전환 기능 등록: 미디어 패널 "전환" 탭과 속성 패널 "전환" 탭(TransitionInspector 모듈이 로드되며 등록). App 이 side-effect import. */
import { registerMediaPanelTab } from '../media/panel-tabs';
import { TransitionGallery } from './TransitionGallery';
import './TransitionInspector';

registerMediaPanelTab({ id: 'transitions', label: '전환', order: 10, component: TransitionGallery });
