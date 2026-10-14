---
id: sh-classic
name: SH Classic
country: KR
category: desktop-business
homepage: 'https://github.com/coolmarvel/sh-design-system'
primary_color: '#2f6fed'
omd: '0.1'
mode: owned # 남의 브랜드를 관찰한 것이 아니라 이성현이 소유한 디자인 시스템
created: '2026-10-13'
updated: '2026-10-13'
author: 이성현 (SeongHyun Lee)
lineage:
  base: [sh-web-editor, sh-messenger] # 2026-10-13 사용자 지정 - 두 프로젝트가 기준, 나머지는 이 둘을 차용
  sh-web-editor: '크롬 실측값(DEXT5 3.5, 기본 회색 스킨, 2026-10-13 사용자 결정), 스킨 13종, 베벨 버튼, hover 테두리, 메뉴·툴바·대화상자 배치'
  sh-messenger: '중립 팔레트(글자·선·면), accent, 그림자, 타입 스케일, 프레임리스 타이틀바, 컨텍스트 메뉴 문법, 다크'
  refined_by: [sh-compositor, sh-econsent, sh-form-designer, remote-assist, pdf-editor-live]
platforms: [css, scss, less, js, tailwind3, tailwind4, dtcg, wpf, avalonia, ios, android, compose, flutter]
components:
  button:
    {
      bg: gradient.bevel,
      border: '1px color.control.border',
      radius: radius.none,
      height: size.control.md,
      padding: '0 space.12',
      font: 'font.size.body / font.weight.semibold',
      hover: 'bg color.canvas + border color.hover-edge',
      pressed: 'bg color.control.pressed',
      focus: '1px dotted color.text, inset 3px',
    }
  button-primary:
    {
      bg: color.accent,
      border: '1px color.accent-pressed',
      fg: color.on-accent,
      hover: color.accent-hover,
      pressed: color.accent-pressed,
      rule: '화면·대화상자마다 하나',
    }
  tool-button:
    {
      bg: transparent,
      border: '1px transparent',
      size: size.tool-button,
      icon: size.icon,
      hover: 'bg color.canvas + border color.hover-edge',
      on: 'bg gradient.pressed + border color.chrome.toolbar-edge',
    }
  input:
    {
      bg: color.canvas,
      border: '1px color.border-strong',
      height: size.control.md,
      padding: '0 space.4',
      hover: 'border color.hover-edge',
      focus: 'border color.accent (링 없음)',
    }
  menubar: { height: size.menubar, bg: gradient.chrome, border-bottom: '1px color.chrome.frame', item-hover: 'bg color.canvas + border color.chrome.frame' }
  menu:
    {
      bg: color.canvas,
      border: '1px color.border-strong',
      shadow: shadow.raised,
      item-height: size.menu-item,
      item-hover: color.chrome.toolbar-face,
      min-width: size.menu-min-width,
    }
  toolbar: { height: size.toolbar, bg: gradient.toolbar, border-bottom: '1px color.chrome.toolbar-hairline', separator: '1px color.chrome.separator' }
  statusbar: { height: size.statusbar, bg: gradient.status, border-top: '1px color.chrome.status-top', pane: '오목 칸 size.status-pane, font.size.caption' }
  tab: { height: size.tab, active: 'color.canvas + 1px color.chrome.frame, 아래선 없음', inactive: gradient.status, rule: '선택해도 크기·굵기 불변' }
  table:
    {
      row: size.row,
      header: 'size.table-header, gradient.bevel, font.weight.regular',
      grid: '1px color.grid',
      hover: color.hover,
      selected: color.accent-subtle,
    }
  tree:
    {
      row: size.tree-row,
      indent: size.tree-indent,
      line: '1px dotted color.tree.line',
      box: 'size.tree-box, 1px color.tree.box',
      selected: '라벨만 color.accent-subtle + 1px color.hover-edge',
    }
  dialog:
    {
      bg: color.canvas,
      border: '1px color.chrome.frame',
      shadow: shadow.dialog,
      title: 'size.dialog-title, gradient.chrome, font.size.emphasis bold',
      buttons: 'gradient.status, 오른쪽 정렬, min size.dialog-button-min',
      scrim: color.scrim,
    }
  checkbox: { size: size.checkbox, bg: color.canvas, border: '1px color.border-strong', check: 'color.text ✓' }
  tooltip: { bg: color.warning-subtle, border: '1px color.border-strong', font: font.size.caption, shadow: shadow.raised, arrow: none }
tokens:
  source: tokens/base/*.json (sh-design-system SSOT) - npm run build 가 생성
  colors:
    accent: '#2f6fed'
    accent-hover: '#255fd1'
    accent-pressed: '#1f4fb0'
    accent-subtle: '#e9f0ff'
    accent-subtle-hover: '#dbe6fc'
    hover-edge: '#2a8dd4'
    canvas: '#ffffff'
    sunken: '#f5f6f8'
    hover: '#eef0f3'
    border: '#e3e5ea'
    border-strong: '#8a919e'
    grid: '#d4d4d4'
    text: '#1f2329'
    text-secondary: '#5c6370'
    text-muted: '#6e7683'
    text-disabled: '#a2a8b3'
    on-accent: '#ffffff'
    link: '#1d5fd6'
    danger: '#d42f37'
    danger-subtle: '#fef2f2'
    danger-border: '#f1a9ad'
    success: '#15803d'
    success-subtle: '#e7f5ec'
    warning: '#8a5a00'
    warning-subtle: '#fff4d6'
    scrim: '#00000026'
    control-top: '#ffffff'
    control-bottom: '#e6e6e6'
    control-pressed: '#d6d9df'
    control-border: '#b5b5b5'
    chrome-frame: '#b8babc'
    chrome-menubar-top: '#f4f4f4'
    chrome-menubar-bottom: '#dfdfdf'
    chrome-toolbar-light: '#fafbff'
    chrome-toolbar-face: '#eaeaea'
    chrome-toolbar-row2-bottom: '#eaeaea'
    chrome-toolbar-hairline: '#b8babc'
    chrome-toolbar-edge: '#b8babc'
    chrome-pressed: '#d5d5d5'
    chrome-pressed-light: '#f2f2f2'
    chrome-separator: '#c6c6c6'
    chrome-status-top: '#d4d4d4'
    chrome-status-light: '#f8f8f8'
    chrome-status-face: '#ececec'
    chrome-tab-active: '#e2e2e3'
    chrome-tab-divider: '#b8babc'
    stage-image: '#1e2025'
    stage-document: '#8a8f98'
    stage-viewer: '#5a5e66'
    stage-checker-a: '#3a3d45'
    stage-checker-b: '#2a2c32'
    tree-line: '#9aa0a8'
    tree-box: '#7b8490'
  gradients:
    chrome: 'linear-gradient(to bottom, #f4f4f4 0%, #dfdfdf 100%)'
    toolbar: 'linear-gradient(to bottom, #fafbff 0%, #eaeaea 100%)'
    toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #eaeaea 100%)'
    status: 'linear-gradient(to bottom, #f8f8f8 0%, #ececec 100%)'
    pressed: 'linear-gradient(to bottom, #f2f2f2 0%, #d5d5d5 100%)'
    bevel: 'linear-gradient(to bottom, #ffffff 0%, #e6e6e6 100%)'
  typography:
    family-ui: 돋움, Dotum, 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif
    family-ui-skia: "'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif"
    family-content: 굴림, Gulim, 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif
    family-mono: "'Cascadia Mono', Consolas, D2Coding, ui-monospace, monospace"
    size-caption: 11px
    size-body: 12px
    size-emphasis: 13px
    size-title: 14px
    size-heading: 16px
    weight-regular: 400
    weight-semibold: 600
    weight-bold: 700
    line-height-tight: 1.2
    line-height-dense: 1.3
    line-height-normal: 1.45
  spacing:
    '0': 0px
    '2': 2px
    '4': 4px
    '6': 6px
    '8': 8px
    '12': 12px
    '16': 16px
    '20': 20px
    '24': 24px
    '32': 32px
    '48': 48px
  sizes:
    control-sm: 22px
    control-md: 24px
    control-lg: 28px
    tool-button: 24px
    icon: 16px
    titlebar: 28px
    menubar: 22px
    toolbar: 30px
    statusbar: 22px
    status-pane: 16px
    panel-title: 22px
    dialog-title: 28px
    dialog-button-min: 72px
    row: 22px
    table-header: 24px
    menu-item: 22px
    menu-min-width: 180px
    tab: 24px
    tree-row: 19px
    tree-indent: 16px
    tree-box: 9px
    checkbox: 13px
    scrollbar: 12px
    splitter: 5px
    window-button: 40px
  rounded:
    none: 0px
    round: 9999px
  borders:
    width: 1px
    focus-offset: -3px
  shadows:
    raised: '2px 2px 4px 0px #0000002e'
    dialog: '3px 3px 6px 0px #00000038'
    page: '2px 2px 0px 0px #00000059'
  motion:
    duration-none: 0ms
    duration-fast: 100ms
themes:
  brand-compositor:
    description: '앱 브랜드 파랑 #3b74f2 - sh-compositor·file-converter·pdf-editor 의 accent'
    tokens:
      color-accent: '#336ef1'
      color-accent-hover: '#2c5cd9'
      color-accent-pressed: '#2149b3'
      color-accent-subtle: '#eef3fe'
  dark:
    description: 다크 - sh-messenger 다크 팔레트. 클래식 기본은 라이트, 어두운 작업실·야간용
    tokens:
      color-accent: '#3c71df'
      color-accent-hover: '#4f80e8'
      color-accent-pressed: '#2f5fc4'
      color-accent-subtle: '#263651'
      color-accent-subtle-hover: '#2d4063'
      color-hover-edge: '#6fa3ff'
      color-canvas: '#2a2c32'
      color-sunken: '#212328'
      color-hover: '#33353c'
      color-border: '#3a3d45'
      color-border-strong: '#7a808b'
      color-grid: '#3a3d45'
      color-text: '#dde0e5'
      color-text-secondary: '#a0a6b1'
      color-text-muted: '#9098a5'
      color-text-disabled: '#6b717c'
      color-link: '#6fa3ff'
      color-danger: '#f5686c'
      color-danger-subtle: '#3d2326'
      color-danger-border: '#7a3236'
      color-success: '#4cc47a'
      color-success-subtle: '#1f3327'
      color-warning: '#e3b341'
      color-warning-subtle: '#3a3120'
      color-scrim: '#000000a6'
      color-control-top: '#3a3d45'
      color-control-bottom: '#2a2c32'
      color-control-pressed: '#212328'
      color-control-border: '#7a808b'
      color-chrome-frame: '#17181c'
      color-chrome-menubar-top: '#33353c'
      color-chrome-menubar-bottom: '#2a2c32'
      color-chrome-toolbar-light: '#33353c'
      color-chrome-toolbar-face: '#2a2c32'
      color-chrome-toolbar-row2-bottom: '#26282d'
      color-chrome-toolbar-hairline: '#3a3d45'
      color-chrome-toolbar-edge: '#5e636d'
      color-chrome-pressed: '#1c1d21'
      color-chrome-pressed-light: '#26282d'
      color-chrome-separator: '#3a3d45'
      color-chrome-status-top: '#3a3d45'
      color-chrome-status-light: '#2a2c32'
      color-chrome-status-face: '#212328'
      color-chrome-tab-active: '#33353c'
      color-chrome-tab-divider: '#3a3d45'
      color-tree-line: '#5e636d'
      shadow-raised: '2px 2px 4px 0px #00000080'
      shadow-dialog: '3px 3px 6px 0px #00000099'
      gradient-chrome: 'linear-gradient(to bottom, #33353c 0%, #2a2c32 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #33353c 0%, #2a2c32 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #2a2c32 0%, #26282d 100%)'
      gradient-status: 'linear-gradient(to bottom, #2a2c32 0%, #212328 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #26282d 0%, #1c1d21 100%)'
      gradient-bevel: 'linear-gradient(to bottom, #3a3d45 0%, #2a2c32 100%)'
  pacsplus:
    description: PACSPLUS Viewer 하늘색 - 의료 영상 뷰어 계열 (remote-assist 실측)
    tokens:
      color-accent: '#0062df'
      color-accent-hover: '#1375ec'
      color-accent-pressed: '#003597'
      color-border-strong: '#707070'
      color-text: '#000000'
      color-text-secondary: '#565d6a'
      color-text-disabled: '#8e929b'
      color-control-bottom: '#dddddd'
      color-control-border: '#707070'
      color-chrome-frame: '#a0a0a0'
      color-chrome-menubar-top: '#bee1ff'
      color-chrome-menubar-bottom: '#bee1ff'
      color-chrome-toolbar-light: '#bee1ff'
      color-chrome-toolbar-face: '#bee1ff'
      color-chrome-toolbar-row2-bottom: '#bee1ff'
      color-chrome-toolbar-hairline: '#a0a0a0'
      color-chrome-toolbar-edge: '#707070'
      color-chrome-pressed: '#dddddd'
      color-chrome-pressed-light: '#f0f0f0'
      color-chrome-separator: '#a0a0a0'
      color-chrome-status-top: '#a0a0a0'
      color-chrome-status-light: '#bee1ff'
      color-chrome-status-face: '#bee1ff'
      color-chrome-tab-active: '#31adff'
      color-chrome-tab-divider: '#a0a0a0'
      color-stage-image: '#000000'
      gradient-chrome: 'linear-gradient(to bottom, #bee1ff 0%, #bee1ff 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #bee1ff 0%, #bee1ff 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #bee1ff 100%)'
      gradient-status: 'linear-gradient(to bottom, #bee1ff 0%, #bee1ff 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #f0f0f0 0%, #dddddd 100%)'
      gradient-bevel: 'linear-gradient(to bottom, #ffffff 0%, #dddddd 100%)'
      font-family-ui: 굴림, Gulim, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif, 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif
  skin-blue:
    description: DEXT5 파랑 스킨 - sh-web-editor·sh-compositor 기본이던 크롬 색 (DEXT5 3.5 blue 실측)
    tokens:
      color-chrome-frame: '#a1abb9'
      color-chrome-menubar-top: '#edf2f6'
      color-chrome-menubar-bottom: '#d9e1ec'
      color-chrome-toolbar-face: '#e6edf6'
      color-chrome-toolbar-row2-bottom: '#ecf1f7'
      color-chrome-toolbar-hairline: '#bbc5d4'
      color-chrome-toolbar-edge: '#afb6c6'
      color-chrome-pressed: '#d3dbe7'
      color-chrome-pressed-light: '#eff1f5'
      color-chrome-separator: '#c5ccd9'
      color-chrome-tab-active: '#d7dde9'
      color-chrome-tab-divider: '#dbdbdb'
      gradient-chrome: 'linear-gradient(to bottom, #edf2f6 0%, #d9e1ec 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #fafbff 0%, #e6edf6 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #ecf1f7 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #eff1f5 0%, #d3dbe7 100%)'
  skin-brown:
    description: DEXT5 갈색 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#cb9958'
      color-chrome-menubar-top: '#f7e2c1'
      color-chrome-menubar-bottom: '#e9bf7f'
      color-chrome-toolbar-light: '#fef8ea'
      color-chrome-toolbar-face: '#e2cba3'
      color-chrome-toolbar-row2-bottom: '#e4cea8'
      color-chrome-toolbar-hairline: '#ddae70'
      color-chrome-toolbar-edge: '#cb9958'
      color-chrome-pressed: '#d6b884'
      color-chrome-pressed-light: '#f8f4eb'
      color-chrome-separator: '#dcad70'
      color-chrome-status-top: '#e1cc99'
      color-chrome-status-light: '#fff8ec'
      color-chrome-status-face: '#fff6e7'
      color-chrome-tab-active: '#e8d5b0'
      color-chrome-tab-divider: '#cb9958'
      gradient-chrome: 'linear-gradient(to bottom, #f7e2c1 0%, #e9bf7f 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #fef8ea 0%, #e2cba3 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #e4cea8 100%)'
      gradient-status: 'linear-gradient(to bottom, #fff8ec 0%, #fff6e7 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #f8f4eb 0%, #d6b884 100%)'
  skin-darkgray:
    description: DEXT5 진회색 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#7d7d7d'
      color-chrome-menubar-top: '#bbbbbb'
      color-chrome-menubar-bottom: '#969696'
      color-chrome-toolbar-light: '#e8e8e8'
      color-chrome-toolbar-face: '#bababa'
      color-chrome-toolbar-row2-bottom: '#b0aeae'
      color-chrome-toolbar-hairline: '#929292'
      color-chrome-toolbar-edge: '#7d7d7d'
      color-chrome-pressed: '#b8b8b8'
      color-chrome-pressed-light: '#f4f4f4'
      color-chrome-separator: '#969390'
      color-chrome-status-top: '#c8c8c8'
      color-chrome-status-light: '#f5f5f5'
      color-chrome-status-face: '#ebebeb'
      color-chrome-tab-active: '#c1c1c1'
      color-chrome-tab-divider: '#7d7d7d'
      gradient-chrome: 'linear-gradient(to bottom, #bbbbbb 0%, #969696 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #e8e8e8 0%, #bababa 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #b0aeae 100%)'
      gradient-status: 'linear-gradient(to bottom, #f5f5f5 0%, #ebebeb 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #f4f4f4 0%, #b8b8b8 100%)'
  skin-gold:
    description: DEXT5 금색 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#c9be7d'
      color-chrome-menubar-top: '#f3eed1'
      color-chrome-menubar-bottom: '#dad2a1'
      color-chrome-toolbar-light: '#fefce9'
      color-chrome-toolbar-face: '#e8e1b4'
      color-chrome-toolbar-row2-bottom: '#e8e1b4'
      color-chrome-toolbar-hairline: '#cfc527'
      color-chrome-toolbar-edge: '#c9be7d'
      color-chrome-pressed: '#d8cd8a'
      color-chrome-pressed-light: '#f9f7e0'
      color-chrome-separator: '#cfc58b'
      color-chrome-status-top: '#ded395'
      color-chrome-status-light: '#f3efd1'
      color-chrome-status-face: '#f6f2da'
      color-chrome-tab-active: '#f6edba'
      color-chrome-tab-divider: '#c9be7d'
      gradient-chrome: 'linear-gradient(to bottom, #f3eed1 0%, #dad2a1 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #fefce9 0%, #e8e1b4 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #e8e1b4 100%)'
      gradient-status: 'linear-gradient(to bottom, #f3efd1 0%, #f6f2da 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #f9f7e0 0%, #d8cd8a 100%)'
  skin-green:
    description: DEXT5 초록 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#98c331'
      color-chrome-menubar-top: '#eafbc5'
      color-chrome-menubar-bottom: '#c5e282'
      color-chrome-toolbar-light: '#f7fee4'
      color-chrome-toolbar-face: '#d1ed8f'
      color-chrome-toolbar-row2-bottom: '#d1ed8f'
      color-chrome-toolbar-hairline: '#b0db49'
      color-chrome-toolbar-edge: '#98c331'
      color-chrome-pressed: '#c1e272'
      color-chrome-pressed-light: '#f4fae8'
      color-chrome-separator: '#b0db4a'
      color-chrome-status-top: '#b5e249'
      color-chrome-status-light: '#f2fade'
      color-chrome-status-face: '#e8f6c6'
      color-chrome-tab-active: '#e1f3b5'
      color-chrome-tab-divider: '#98c331'
      gradient-chrome: 'linear-gradient(to bottom, #eafbc5 0%, #c5e282 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #f7fee4 0%, #d1ed8f 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #d1ed8f 100%)'
      gradient-status: 'linear-gradient(to bottom, #f2fade 0%, #e8f6c6 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #f4fae8 0%, #c1e272 100%)'
  skin-orange:
    description: DEXT5 주황 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#ffa52f'
      color-chrome-menubar-top: '#ffe8bd'
      color-chrome-menubar-bottom: '#ffbb50'
      color-chrome-toolbar-light: '#fff7e9'
      color-chrome-toolbar-face: '#ffce89'
      color-chrome-toolbar-row2-bottom: '#ffcc85'
      color-chrome-toolbar-hairline: '#ffb452'
      color-chrome-toolbar-edge: '#ffa52f'
      color-chrome-pressed: '#ffc679'
      color-chrome-pressed-light: '#fff6ea'
      color-chrome-separator: '#ffb34f'
      color-chrome-status-top: '#ffbf6b'
      color-chrome-status-light: '#fdf5e7'
      color-chrome-status-face: '#fbe9cc'
      color-chrome-tab-active: '#ffd49d'
      color-chrome-tab-divider: '#ffa52f'
      gradient-chrome: 'linear-gradient(to bottom, #ffe8bd 0%, #ffbb50 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #fff7e9 0%, #ffce89 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #ffcc85 100%)'
      gradient-status: 'linear-gradient(to bottom, #fdf5e7 0%, #fbe9cc 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #fff6ea 0%, #ffc679 100%)'
  skin-pink:
    description: DEXT5 분홍 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#d5a8d5'
      color-chrome-menubar-top: '#fcecfb'
      color-chrome-menubar-bottom: '#f0c6f0'
      color-chrome-toolbar-light: '#fef8fe'
      color-chrome-toolbar-face: '#f8def8'
      color-chrome-toolbar-row2-bottom: '#f8def8'
      color-chrome-toolbar-hairline: '#dfbcdf'
      color-chrome-toolbar-edge: '#d5a8d5'
      color-chrome-pressed: '#e6bbe6'
      color-chrome-pressed-light: '#f4e4f3'
      color-chrome-separator: '#dfbcdf'
      color-chrome-status-top: '#e7c4e7'
      color-chrome-status-light: '#f9f1f8'
      color-chrome-status-face: '#fcf6fa'
      color-chrome-tab-active: '#f2deee'
      color-chrome-tab-divider: '#d5a8d5'
      gradient-chrome: 'linear-gradient(to bottom, #fcecfb 0%, #f0c6f0 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #fef8fe 0%, #f8def8 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #f8def8 100%)'
      gradient-status: 'linear-gradient(to bottom, #f9f1f8 0%, #fcf6fa 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #f4e4f3 0%, #e6bbe6 100%)'
  skin-purple:
    description: DEXT5 보라 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#ae9bd5'
      color-chrome-menubar-top: '#f3ecff'
      color-chrome-menubar-bottom: '#d8c9f2'
      color-chrome-toolbar-light: '#fbfaff'
      color-chrome-toolbar-face: '#e4daf7'
      color-chrome-toolbar-row2-bottom: '#ddd0f1'
      color-chrome-toolbar-hairline: '#c5b3e7'
      color-chrome-toolbar-edge: '#b5a2da'
      color-chrome-pressed: '#ded3f1'
      color-chrome-pressed-light: '#faf8fd'
      color-chrome-separator: '#b5a3d9'
      color-chrome-status-top: '#ccb8ec'
      color-chrome-status-light: '#f2eef6'
      color-chrome-status-face: '#f1e8f6'
      color-chrome-tab-active: '#e1d6f3'
      color-chrome-tab-divider: '#ae9bd5'
      gradient-chrome: 'linear-gradient(to bottom, #f3ecff 0%, #d8c9f2 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #fbfaff 0%, #e4daf7 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #ddd0f1 100%)'
      gradient-status: 'linear-gradient(to bottom, #f2eef6 0%, #f1e8f6 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #faf8fd 0%, #ded3f1 100%)'
  skin-red:
    description: DEXT5 빨강 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#eb644e'
      color-chrome-menubar-top: '#ffd6d3'
      color-chrome-menubar-bottom: '#ff968c'
      color-chrome-toolbar-light: '#ffeaea'
      color-chrome-toolbar-face: '#ffc0b9'
      color-chrome-toolbar-row2-bottom: '#febbb4'
      color-chrome-toolbar-hairline: '#ff8f87'
      color-chrome-toolbar-edge: '#f96c55'
      color-chrome-pressed: '#ffaea6'
      color-chrome-pressed-light: '#fff2f1'
      color-chrome-separator: '#ff8f87'
      color-chrome-status-top: '#ffbab5'
      color-chrome-status-light: '#fff2ec'
      color-chrome-status-face: '#ffefe7'
      color-chrome-tab-active: '#ffd2cc'
      color-chrome-tab-divider: '#eb644e'
      gradient-chrome: 'linear-gradient(to bottom, #ffd6d3 0%, #ff968c 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #ffeaea 0%, #ffc0b9 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #febbb4 100%)'
      gradient-status: 'linear-gradient(to bottom, #fff2ec 0%, #ffefe7 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #fff2f1 0%, #ffaea6 100%)'
  skin-silver:
    description: DEXT5 은색 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#acaba7'
      color-chrome-menubar-top: '#ebebe8'
      color-chrome-menubar-bottom: '#c8c7c1'
      color-chrome-toolbar-light: '#f5f5f5'
      color-chrome-toolbar-face: '#d6d5cf'
      color-chrome-toolbar-row2-bottom: '#d6d5cf'
      color-chrome-toolbar-hairline: '#b7b6b1'
      color-chrome-toolbar-edge: '#acaba7'
      color-chrome-pressed: '#bab8ad'
      color-chrome-pressed-light: '#ebeae6'
      color-chrome-separator: '#b7b6b1'
      color-chrome-tab-active: '#dbdad4'
      color-chrome-tab-divider: '#acaba7'
      gradient-chrome: 'linear-gradient(to bottom, #ebebe8 0%, #c8c7c1 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #f5f5f5 0%, #d6d5cf 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #d6d5cf 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #ebeae6 0%, #bab8ad 100%)'
  skin-white:
    description: DEXT5 흰색 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#b1b2b4'
      color-chrome-menubar-top: '#ffffff'
      color-chrome-menubar-bottom: '#f3f3f3'
      color-chrome-toolbar-light: '#ffffff'
      color-chrome-toolbar-face: '#ffffff'
      color-chrome-toolbar-row2-bottom: '#ffffff'
      color-chrome-toolbar-hairline: '#b1b2b4'
      color-chrome-toolbar-edge: '#b1b2b4'
      color-chrome-pressed: '#f6f6f6'
      color-chrome-pressed-light: '#fefefe'
      color-chrome-separator: '#b7b8ba'
      color-chrome-status-light: '#f3f3f3'
      color-chrome-status-face: '#f3f3f3'
      color-chrome-tab-active: '#ffffff'
      color-chrome-tab-divider: '#b1b2b4'
      gradient-chrome: 'linear-gradient(to bottom, #ffffff 0%, #f3f3f3 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #ffffff 0%, #ffffff 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #ffffff 100%)'
      gradient-status: 'linear-gradient(to bottom, #f3f3f3 0%, #f3f3f3 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #fefefe 0%, #f6f6f6 100%)'
  skin-yellow:
    description: DEXT5 노랑 스킨 - 크롬 색만 교체 (sh-web-editor skins.css 실측)
    tokens:
      color-chrome-frame: '#cfc700'
      color-chrome-menubar-top: '#fdfed8'
      color-chrome-menubar-bottom: '#e6de6e'
      color-chrome-toolbar-light: '#fefee9'
      color-chrome-toolbar-face: '#f3ee96'
      color-chrome-toolbar-row2-bottom: '#f7f07b'
      color-chrome-toolbar-hairline: '#dcd400'
      color-chrome-toolbar-edge: '#cfc700'
      color-chrome-pressed: '#f1ea8d'
      color-chrome-pressed-light: '#fdfced'
      color-chrome-separator: '#dad20b'
      color-chrome-status-top: '#e6de1b'
      color-chrome-status-light: '#fdfde7'
      color-chrome-status-face: '#fbfbcc'
      color-chrome-tab-active: '#ebe486'
      color-chrome-tab-divider: '#d8d003'
      gradient-chrome: 'linear-gradient(to bottom, #fdfed8 0%, #e6de6e 100%)'
      gradient-toolbar: 'linear-gradient(to bottom, #fefee9 0%, #f3ee96 100%)'
      gradient-toolbar2: 'linear-gradient(to bottom, #ffffff 0%, #f7f07b 100%)'
      gradient-status: 'linear-gradient(to bottom, #fdfde7 0%, #fbfbcc 100%)'
      gradient-pressed: 'linear-gradient(to bottom, #fdfced 0%, #f1ea8d 100%)'
  touch:
    description: 터치 밀도 - 환자용 화면·coarse 포인터. 색은 그대로, 크기만 키운다 (sh-econsent .touch, pdf-editor coarse)
    tokens:
      size-control-sm: 40px
      size-control-md: 48px
      size-control-lg: 52px
      size-tool-button: 48px
      size-icon: 24px
      size-toolbar: 56px
      size-statusbar: 28px
      size-row: 45px
      size-menu-item: 40px
      size-tab: 40px
      size-tree-row: 32px
      size-checkbox: 24px
      size-scrollbar: 16px
      size-splitter: 12px
      font-size-caption: 13px
      font-size-body: 16px
      font-size-emphasis: 17px
      font-size-title: 18px
---

# SH Classic - 디자인 계약

> 이 문서는 **AI 에이전트와 사람이 함께 따르는 UI 계약**이다. 값은 위 머리말의 `tokens:` 와 `design-tokens/`
> 생성 파일에서만 가져온다. 화면 코드에 hex·px 리터럴을 새로 쓰지 않는다.
> 머리말의 `tokens:`·`themes:` 는 sh-design-system 빌드가 생성한다. 손으로 고치지 않는다.

## 1. Visual Theme & Atmosphere

옛 Windows 업무 프로그램처럼 **사각사각하고 촘촘한** 화면이다. 2000년대 국산 업무용 소프트웨어(DEXT5 에디터,
PACS 뷰어, 메신저 PC 판)의 문법을 지금 기술로 다시 만든다.

- 반경 0, 모든 선 1px, 돋움 12px, 컨트롤 높이 24px.
- 크롬(메뉴바·툴바·상태 줄)은 얕은 세로 그라데이션 띠. 버튼은 흰색에서 회색으로 내려가는 베벨.
- 색은 아낀다. 크롬은 회색·옅은 파랑, 채도 있는 색은 주 동작·선택·포커스와 hover 테두리에만.
- 기능은 메뉴에서 찾는다. 툴바·버튼은 메뉴의 지름길이다.
- 웹처럼 넉넉한 여백, 둥근 카드, 큰 그림자, 히어로 영역은 이 시스템에 없다.

사용자 정의 (2026-09-05): "옛스러우면서 사각사각하고 컴팩트한 UI". (2026-09-28): "밝은 카드형 대시보드나 큰
둥근 버튼으로 재해석하지 않는다. 상단 메뉴·탭·베벨 버튼·조밀한 표·셀렉트박스/드롭다운."

## 2. Color & surface roles

| 역할         | 토큰                                                                                                                                  | 쓰는 곳                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 흰 면        | `--sh-color-canvas`                                                                                                                   | 입력·표·목록·대화상자 본문·활성 탭·메뉴 판                                    |
| 앱 바탕      | `--sh-color-sunken`                                                                                                                   | 창 바탕, 사이드바, 비활성 입력 면                                             |
| hover 면     | `--sh-color-hover`                                                                                                                    | 목록·표 행, 트리 라벨                                                         |
| 선택 면      | `--sh-color-accent-subtle`                                                                                                            | 선택 행, 선택 라벨, 켜진 세그먼트. 글자는 진한 색 그대로                      |
| 강조         | `--sh-color-accent`                                                                                                                   | 주 버튼 채움, 입력 포커스 테두리, 진행 막대. **배지·성공 표시에 재사용 금지** |
| hover 테두리 | `--sh-color-hover-edge`                                                                                                               | 베벨·도구 버튼·입력·탭의 hover 1px 테두리. 크롬에서 유일한 채도               |
| 글자         | `--sh-color-text` · `--sh-color-text-secondary` · `--sh-color-text-muted` · `--sh-color-text-disabled`                                | 본문 / 보조 라벨 / 단축키·설명 / 비활성                                       |
| 선           | `--sh-color-border` · `--sh-color-border-strong` · `--sh-color-grid` · `--sh-color-chrome-frame`                                      | 안쪽 헤어라인 / 입력·메뉴 판 / 표 격자 / 패널·창 테두리                       |
| 베벨         | `--sh-color-control-top` 에서 `--sh-color-control-bottom` 으로, 테두리 `--sh-color-control-border`, 눌림 `--sh-color-control-pressed` | 버튼·표 머리글·패널 제목 띠                                                   |
| 크롬         | `--sh-color-chrome-*` (16개)                                                                                                          | 메뉴바·툴바·상태 줄·탭. **스킨 테마가 이 그룹만 바꾼다**                      |
| 의미         | danger · success · warning (+ `-subtle`)                                                                                              | 삭제·오류 / 완료 / 주의. 툴팁 면은 `--sh-color-warning-subtle`                |
| 스테이지     | `--sh-color-stage-image` · `--sh-color-stage-document` · `--sh-color-stage-viewer`                                                    | 이미지 보기 / 종이 편집 / 작성 뷰어의 바탕                                    |

- 라이트 테마에서 본문에 순검정(#000)을 쓰지 않는다. `--sh-color-text` 를 쓴다.
- 대비 기준은 `tokens/contrast.json` 이 모든 테마에서 강제한다. 본문 글자 4.5:1, 비텍스트 표시 3:1.

## 3. Typography & font evidence

| 역할          | 토큰                       | 값                                                                          |
| ------------- | -------------------------- | --------------------------------------------------------------------------- |
| UI 글꼴       | `--sh-font-family-ui`      | 돋움, 맑은 고딕, Apple SD Gothic Neo, Noto Sans KR 순                       |
| Avalonia/Skia | `--sh-font-family-ui-skia` | 맑은 고딕 우선. 돋움 비트맵이 비정수 크기·합성 굵게에서 깨진다 (2026-10-01) |
| 편집 콘텐츠   | `--sh-font-family-content` | 굴림 (문서·에디터 본문)                                                     |
| 고정폭        | `--sh-font-family-mono`    | Cascadia Mono, Consolas, D2Coding 순                                        |

크기는 다섯 단계만 쓴다: caption 11 · **body 12 (기본)** · emphasis 13 · title 14 · heading 16.
굵기는 400 · 600(버튼) · 700(제목·legend, 상한). 줄 높이는 1.2 / 1.3 / 1.45.

- 크롬 글자는 14px 를 넘지 않는다. 16px 는 문서·안내 페이지 제목에만.
- 글자 크기는 정수 px 만. 11.5px 같은 값은 돋움이 깨진다.
- `letter-spacing`·대문자 변환을 쓰지 않는다. 글꼴 스무딩(`-webkit-font-smoothing`)을 건드리지 않는다.
- 숫자 열(크기·시간·좌표)은 `font-variant-numeric: tabular-nums`.
- 한국어 본문은 `word-break: keep-all`. 크롬 라벨은 줄바꿈하지 않는다(`nowrap` + 말줄임).

## 4. Components

모든 부품은 **반경 0, 1px 선, 12px 글자**다. 상태 다섯 가지(기본·hover·눌림·포커스·비활성)와 해당하면 선택/켜짐을
모두 그린다. 쇼케이스 `showcase/index.html` 이 각 상태의 기준 화면이다.

### 4.1 버튼

| 종류         | 기본                                                                   | hover                                                     | 눌림                                    | 비활성                                                                              |
| ------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| 기본(베벨)   | `--sh-gradient-bevel` 면, 1px `--sh-color-control-border`, 글자 600    | 흰 면 + 1px `--sh-color-hover-edge`                       | `--sh-color-control-pressed` 단색(오목) | 면 `--sh-color-sunken`, 테두리 `--sh-color-border`, 글자 `--sh-color-text-disabled` |
| 주(primary)  | `--sh-color-accent` 채움, 1px `--sh-color-accent-pressed`, 흰 글자     | `--sh-color-accent-hover`                                 | `--sh-color-accent-pressed`             | 면 `--sh-color-control-bottom`, 글자 비활성                                         |
| 위험(외곽선) | 베벨 면 + 글자 `--sh-color-danger` + 테두리 `--sh-color-danger-border` | 면 `--sh-color-danger-subtle`, 테두리 `--sh-color-danger` | 눌림 면                                 | 기본과 같음                                                                         |
| 위험(채움)   | `--sh-color-danger` 채움 + 흰 글자                                     | 조금 어둡게                                               | -                                       | -                                                                                   |

- 높이 24 (`--sh-size-control-md`), 좌우 패딩 12, 작은 버튼 22. 대화상자 버튼 최소 폭 72.
- **주 버튼은 한 화면·한 대화상자에 하나.** 버튼 순서는 보조 다음에 주. 위험 동작이 주이면 맨 오른쪽.
- 삭제류 버튼은 빨강 외곽선. 되돌릴 수 없는 확인 대화상자의 주 버튼만 빨강 채움.
- 로딩 중에는 폭을 유지하고 라벨 자리에 12px 스피너.

### 4.2 도구 버튼·툴바

- 툴바 높이 30, 면 `--sh-gradient-toolbar`, 아래 1px `--sh-color-chrome-toolbar-hairline`. 두 번째 줄(옵션 바)은 `--sh-gradient-toolbar2`.
- 도구 버튼 24×24, 아이콘 16. 평소 투명 면·투명 테두리. hover = 흰 면 + 1px hover-edge.
  눌림·켜짐 = `--sh-gradient-pressed` 면 + 1px `--sh-color-chrome-toolbar-edge`. 비활성 = 아이콘 불투명도 0.35.
- 라벨이 있는 도구 버튼은 아이콘 16 + 12px 라벨을 가로로. 데스크톱 툴바에서 라벨 없는 아이콘 버튼은 툴팁 필수.
- 구분선은 1px `--sh-color-chrome-separator` 단선, 높이 18, 좌우 여백 4. 흰 하이라이트를 붙이지 않는다 (2026-09-08 실측).
- 툴바 안의 글자·입력·콤보·버튼은 **모두 세로 가운데, 높이 24 한 줄**로 맞춘다 (2026-10-01).
- 넘치면 오른쪽 `»` 버튼이 남은 항목을 펼친다.

### 4.3 메뉴바·드롭다운·컨텍스트 메뉴

- 메뉴바 높이 22, 면 `--sh-gradient-chrome`, 아래 1px frame. 제목 12px, 좌우 패딩 8.
  제목 hover·열림 = 흰 면 + 1px frame 테두리. 열린 상태에서 옆 제목에 올리면 그 메뉴로 바뀐다. Alt 로 첫 메뉴.
- 메뉴 판: 흰 면, 1px `--sh-color-border-strong`, `--sh-shadow-raised`, 위아래 패딩 2, 최소 폭 180.
- 항목 높이 22, 왼쪽 16px 체크·아이콘 열, 오른쪽에 단축키(11px muted), 하위 메뉴는 ▸.
  hover = `--sh-color-chrome-toolbar-face` 면. 비활성 = 글자 `--sh-color-text-disabled`. 구분선 1px `--sh-color-border`.
- 컨텍스트(우클릭) 메뉴도 같은 부품이다. 호버로만 드러나는 보조 아이콘 대신 우클릭 메뉴에 넣는다.
- 화면 밖으로 나가면 안쪽·위로 연다. Esc·바깥 클릭·창 크기 변경에 닫는다. ↑↓ Home End Enter.
- **모든 기능은 메뉴에도 있다.** 툴바·패널 버튼에만 있는 기능을 만들지 않는다. 단축키는 메뉴 오른쪽에 적는다.

### 4.4 탭

- 높이 24 고정. 활성 = 흰 면 + 1px frame 테두리(아래선 없음, 본문과 이어짐), 글자 `--sh-color-text`.
  비활성 = `--sh-gradient-status` 면, 글자 `--sh-color-text-secondary`. hover 테두리 hover-edge.
- **선택해도 크기·굵기가 변하지 않는다. 면과 글자 색만 바뀐다** (2026-10-01 "커지는 탭이 어색하다").
  밑줄 indicator 를 쓰지 않는다.
- 탭을 바꿔도 대화상자 크기는 고정한다(가장 큰 탭 기준).
- 문서 탭 닫기 버튼 15×15, 가는 ✕, hover 시 danger 채움 + 흰 ✕. 수정됨 표시는 6px accent 점(유일한 원형).

### 4.5 입력·콤보·날짜

- 높이 24, 흰 면, 1px `--sh-color-border-strong`, 좌우 패딩 4, 12px. hover 테두리 hover-edge.
  포커스 = 테두리만 `--sh-color-accent` (바깥 링 없음). 오류 = 테두리·도움말 danger. 비활성 = 면 sunken, 글자 muted.
- 콤보: 같은 상자 + 오른쪽 7×4 삼각형. 목록 판은 메뉴 판과 같고 항목 22, hover `--sh-color-hover`, 현재 값 `--sh-color-accent-subtle`.
- 라벨은 왼쪽 열(같은 x 에서 컨트롤 시작) 또는 위 4px. 숫자 스피너 화살표는 숨긴다.
- 날짜는 입력칸 + 달력 아이콘 버튼. 숫자만 쳐도 하이픈을 넣는다. Fluent CalendarDatePicker 를 쓰지 않는다.

### 4.6 체크박스·라디오·세그먼트

- 체크박스 13×13, 흰 면, 1px border-strong, **체크 = 진한 글자색 ✓** (accent 채움 아님). 중간 상태 = 7×7 사각. hover 테두리 hover-edge.
- 라디오 13×13 원 - 반경 예외. 선택 점은 글자색.
- 세그먼트: 1px border-strong 묶음, 항목 22, 베벨 면, 항목 사이 1px. 선택 = `--sh-color-accent-subtle` 면 + 진한 글자 + 600.

### 4.7 표·목록

- 바깥 1px frame, 격자 1px `--sh-color-grid`(가로·세로 모두), 행 22, 셀 패딩 0 4, 줄무늬 없음.
- 머리글 24, `--sh-gradient-bevel` 면, 오른쪽·아래 1px control-border, **보통 굵기**, 왼쪽 정렬.
- hover `--sh-color-hover`, 선택 `--sh-color-accent-subtle` + 글자 그대로. 표 안 체크박스 14.
- 셀은 줄바꿈하지 않는다. 숫자 열은 오른쪽 정렬 + tabular-nums.

### 4.8 트리 (클래식 연결선)

- 행 19, 들여쓰기 16, 단계마다 1px 점선 `--sh-color-tree-line` 세로줄 + 항목으로 꺾이는 가로 점선.
- 자식이 있으면 9×9 [+]/[-] 상자(흰 면, 1px `--sh-color-tree-box`, 기호 글자색).
- hover·선택은 **글자 라벨만** 칠한다(선택 = accent-subtle + 1px hover-edge). 행 전체를 칠하지 않는다.
- 폴더·사람 아이콘과 체크박스를 두지 않는다 (2026-10-01).

### 4.9 대화상자

- 흰 면, 1px frame, `--sh-shadow-dialog`, 덮개 `--sh-color-scrim`(검정 15%) 화면 전체.
- 제목 띠 28, `--sh-gradient-chrome`, 13px bold, 아래 1px frame. **제목 띠를 끌어 화면 어디로든 옮긴다.** 오른쪽 ✕.
- 본문 패딩 12. 섹션은 그룹 박스(fieldset 1px frame + 12px bold legend). 카드를 쓰지 않는다.
- 버튼 줄: `--sh-gradient-status` 면 + 위 1px border, 오른쪽 정렬, 간격 8, 최소 폭 72.
- Enter = 주 버튼, Esc = 취소. 파괴 확인 대화상자는 덮개 클릭으로 닫히지 않는다.

### 4.10 상태 줄

- 높이 22, `--sh-gradient-status`, 위 1px `--sh-color-chrome-status-top`. 칸 사이 2.
- 칸 = 오목: 높이 16, 패딩 0 6, 위·왼 1px status-top, 아래·오른 1px 흰색, 11px secondary, 말줄임.
- 진행은 상태 줄의 10px 막대(1px border-strong 테두리, accent 채움)로 보여 준다. 떠 있는 로딩 카드를 쓰지 않는다.

### 4.11 타이틀바 (프레임리스 앱)

- 높이 28, `--sh-gradient-chrome`, 아래 1px frame. 앱 아이콘 16 + 제목 12px bold + 문서명 secondary.
- 창 버튼 40×28, 글리프 10×10 1px. hover = toolbar-face 면, **닫기 hover = danger 채움 + 흰 글리프**.
- 타이틀바에 기능 버튼(검색·초대)을 두지 않는다. 그 아래 30px 도구 행으로.
- OS 둥근 창 모서리·Mica 를 끈다.

### 4.12 패널·사이드바·스플리터

- 패널 = 흰 면 + 1px frame + 제목 띠 22(`--sh-gradient-bevel`, 12px bold, 오른쪽 액션 슬롯). 카드 대신 이것.
- 사이드바는 sunken 면 + 오른쪽 1px frame, 폭 조절 핸들 5px(크롬 면).

### 4.13 툴팁·알림·칩·진행

- 툴팁: `--sh-color-warning-subtle` 면, 1px border-strong, 11px, 패딩 2 6, raised 그림자, **화살표 없음**, 400ms 지연, 마우스 전용.
- 알림 띠: 직각, 1px border-strong, 12px 한 줄, 아이콘 16. 토스트는 오른쪽 아래, 폭 320, 최대 3개.
- 칩: 높이 18, 11px, sunken 면 + 1px border-strong. 의미 칩은 `-subtle` 면 + 의미색 글자.
- 진행 막대 10px, 1px border-strong, accent 채움. 원형 스피너 14.

### 4.14 스크롤바

- 폭 12, 트랙 sunken + 안쪽 1px border, 엄지 `--sh-gradient-bevel` + 1px border-strong, hover 엄지 흰 면. 화살표 버튼 없음.
- WPF·Avalonia 는 같은 규격의 ScrollBar 스타일을 프로젝트에서 만든다.

### 4.15 타임라인 (편집기 전용, 2026-10-14)

구현: `packages/editor/src/features/timeline/` (`timeline.css`). 값은 전부 `--sh-*` 토큰과 그 `calc` 조합이다.

- 골격: 패널(4.12) 안에 툴바(4.2) 한 줄, 그 아래 스크롤 영역(4.14 `.sh-scroll`). 스크롤 영역의 첫 줄은 눈금자, 왼쪽 열은 트랙
  머리이며 둘 다 sticky 로 붙어 있다. 트랙 순서는 위에서 V3 V2 V1, 그 아래 A1 A2 A3.
- 치수: 트랙 머리 폭 112 (`space.48 * 2 + space.16`), 눈금자 높이 22 (`size.row`), 영상 트랙 44 (`size.row * 2`),
  음성 트랙 30 (`size.row + space.8`), 트림 핸들 폭 6 (`space.6`). 데스크톱 패널 높이는 이 합(6트랙이 다 보이게).
  모바일(900 이하)은 머리 48 (`space.48`), 영상 30, 음성 22 로 줄이고 머리의 토글을 숨긴다. 세로 스크롤 허용.
- 트랙 머리: `--sh-gradient-bevel` 면 + 오른쪽 1px control-border + 아래 1px border. 짧은 이름(V1·A1) 12px bold,
  옆에 도구 버튼(4.2) 높이 22, 11px 라벨 "잠금" 과 "음소거"(음성) 또는 "숨김"(영상). 켜짐은 `aria-pressed` 로 4.2 와 같은 눌림 면.
- 눈금자: `--sh-gradient-status` 면, 아래 1px frame. 작은 눈금 1x4 border-strong, 큰 눈금 1x8 + 11px muted 타임코드
  (00:00:00:00, 프레임 경계에 맞춘 정수 프레임 단위). 플레이헤드 머리는 8x8 `--sh-color-accent` 사각(둥근 모양 없음).
- 레인: 영상 `--sh-color-sunken`, 음성 `--sh-color-stage-image`, 아래 1px border. 잠긴 트랙은 sunken 과 canvas 의
  135도 줄무늬(6/2). 끌어다 놓을 때 대상 레인은 `--sh-color-hover` 면, 놓일 자리는 2px accent 세로선.
- 클립 블록: 위아래 2px 띄우고 1px control-border + `--sh-gradient-bevel`(영상) / `--sh-color-hover` 면 + border-strong
  (음성, 글자 secondary). 이름 12px 한 줄 말줄임. hover = 테두리 hover-edge. 선택 = `--sh-color-accent-subtle` 면 +
  1px accent-pressed(4.7 선택과 같음, 글자 그대로). 비활성(클립 꺼짐·트랙 숨김·음소거) = 글자 text-disabled. 드래그 중
  고스트 = 점선 accent 테두리. 양 끝 6px 트림 핸들은 hover·선택 때 accent-pressed 로 채운다.
- 플레이헤드 선: 1px accent, 눈금자·트랙 머리 아래로 지나간다. 눈금자나 빈 레인을 누르고 끌면 스크럽.
- 동작과 단축키(패널에 포커스가 있을 때): 자르기 Ctrl+K, 삭제 Delete, 실행 취소 Ctrl+Z, 다시 실행 Ctrl+Shift+Z, 줌 +/-
  와 Ctrl+휠(커서 아래 시간 고정), 스냅 S, 프레임 이동 좌우 화살표(Shift 는 5프레임), Home/End. 툴바 토글 리플·삽입·스냅은
  `aria-pressed`. 모든 편집은 엔진 커맨드로 보내고 `sequence.inspect` 를 다시 읽어 그린다.
- 미디어 패널에서 끌어오기: `dataTransfer` 의 `application/x-sh-media-item` 에 미디어 항목 id(`project.inspect` 의 `item`).
  계약 파일 `features/timeline/dnd.ts`.
- 전환 블록(`features/transitions/`, 2026-10-14): 레인 위쪽에 컷을 가운데 두고 걸친 작은 블록. 위 2px(`space.2`) 띄우고
  높이 12(`space.12`), 1px accent-pressed 테두리 + `--sh-color-accent-subtle` 면, 11px 전환 이름 한 줄 말줄임, 클립보다 위에
  놓인다. 선택 = `--sh-color-accent` 면 + on-accent 글자(`aria-pressed`). 양 끝 6px 길이 핸들은 hover·선택 때 accent-pressed
  로 채우고 끌면 프레임 단위로 양쪽이 같이 늘어난다(두 클립 사이는 가운데 정렬 고정). 한쪽 편집점(페이드 인·아웃)은 컷 반대쪽
  핸들만 보인다. 끌어다 놓을 때 놓일 자리는 점선 accent 고스트 블록. 모바일은 높이 8(`space.8`), 이름 숨김. 갤러리에서
  끌어오기는 `application/x-sh-transition` 에 엔진 전환 id(`effects.list`), 편집점 24px 안에서만 받는다.

### 4.16 스플리터 (편집기 전용, 2026-10-14)

구현: `packages/editor/src/features/layout/` (`Splitter.tsx`, `splitter.css`, `store.ts`). 배치는 `shell/layout.css`.
4.12 의 "폭 조절 핸들 5px" 을 편집기 세 패널(미디어, 미리보기, 타임라인) 사이에 적용한 것이다.

- 모양: 히트 영역 5 (`size.splitter`), 면은 바탕 그대로(투명). 가운데 1px 선(`--sh-color-chrome-frame`)만 보인다.
  hover, 포커스, 드래그 중에는 선이 `--sh-color-accent`. 포커스 링은 공통 점선(1px dotted text, 안쪽 1px). 둥근 모양·그림자 없음.
- 자리: 미디어와 미리보기 사이(세로 선, 커서 col-resize), 본문과 타임라인 사이(가로 선, 커서 row-resize). 한 열 배치(900 이하)에서는
  숨기고 세로로 쌓는다.
- 한계(px, 뷰포트 기준): 미디어 너비 200 이상 60% 이하, 미리보기에는 320 을 남긴다. 타임라인 높이 120 이상 70% 이하, 위 본문에는
  200 을 남긴다. 기본값은 미디어 본문의 1/4, 타임라인은 4.15 의 6트랙 합. 창 크기가 바뀌면 저장값을 다시 한계 안으로 자른다.
- 동작: 포인터 캡처로 끌기(드래그 중 루트에 `data-resizing`, 글자 선택 금지, 커서 고정). 더블클릭과 Enter 는 기본값 복귀. 키보드 화살표
  (세로 선은 좌우, 가로 선은 상하) 8px, Home/End 는 최소/최대.
- 접근성: `role="separator"`, `aria-orientation`, `aria-valuemin/max/now`(px), 한국어 `aria-label`("미디어와 미리보기 너비 조절",
  "미리보기와 타임라인 높이 조절"). 툴팁 title 에 "더블클릭하면 기본 크기".
- 저장: `localStorage` 키 `sh-video-editor.layout.v1` 에 `{ mediaWidth, timelineHeight }`(px, null 은 기본값). 읽기·쓰기는 try/catch.

### 4.17 속도 탭·속도 배지 (편집기 전용, 2026-10-14)

구현: `packages/editor/src/features/speed/` (`SpeedForm.tsx`, `SpeedTab.tsx`, `SpeedBadge.tsx`, `speed.css`). 값은 전부 `--sh-*` 토큰이다.
클립 메뉴 "속도, 길이" 대화상자(`features/shortcuts/SpeedDialog.tsx`)도 같은 폼과 같은 store 를 쓴다.

- 폼 한 줄: 슬라이더(브라우저 기본 range, `accent-color` 만 accent, 높이 24) + 배속 숫자 입력(4.5, 폭 72, 오른쪽 정렬 tabular) + "x".
  슬라이더는 로그 스케일(왼쪽 끝 0.1x, 가운데 1x, 오른쪽 끝 10x). 그 아래 빠른 선택 세그먼트(4.6) 0.5x 1x 2x 4x,
  보간 콤보(프레임 샘플링, 프레임 블렌딩, 옵티컬 플로), 체크박스(4.6) "역방향 재생" 과 "리플".
- 적용 후 길이 줄: secondary 글자, "적용 후 길이 00:00:08:00 (지금 00:00:16:00)". 클립이 없으면 안내 문장.
- 버튼 줄: 주 버튼 "적용" 하나 + 기본 버튼 "이 프레임 고정"(플레이헤드가 선택 클립 위에 없으면 비활성, 툴팁에 이유).
- 속도 배지: 클립 블록(4.15) 이름 오른쪽, 오른쪽 트림 핸들 앞에 붙는 11px tabular 글자. accent-subtle 면 + 1px accent-pressed
  테두리 + accent-pressed 글자, 좌우 패딩 4, 줄 높이 16, 반경 0. 원래 속도·정방향이면 그리지 않는다. 문구는 "2x", "0.5x", "역",
  둘 다면 "2x 역". 포인터 이벤트를 받지 않는다(클립 선택·드래그를 막지 않는다).

### 4.18 화면 비율·SNS 프리셋 (편집기 전용, 2026-10-14)

구현: `packages/editor/src/features/ratio/` (`RatioDialog.tsx`, `RatioBar.tsx`, `SnsPresets.tsx`, `ratio.css`).

- 화면 비율 대화상자(4.9, 시퀀스 메뉴): 안내 문장("지금 1920 x 1080 (16:9). ...") + 그룹 박스 "비율"(라디오 4개: 가로 16:9, 세로 9:16,
  정사각 1:1, 세로 4:5. 라벨 600 + 11px secondary 로 크기와 용도) + 그룹 박스 "클립 맞춤"(라디오 채우기, 맞추기). 버튼 취소, 적용(주).
- 내보내기 대화상자 상단 비율 막대: "화면 비율 1920 x 1080 (16:9)" 글자 + 세그먼트(4.6) 16:9 9:16 1:1 4:5(현재 비율이 선택) +
  클립 맞춤 콤보. 누르면 바로 적용하고 결과 줄을 다시 해석한다. 내보내는 중에는 비활성.
- SNS 프리셋: 그룹 박스 "SNS 프리셋" 안 2열 격자의 선택 버튼(카드가 아니라 세그먼트 항목의 세로 확장이다). 각 버튼은 베벨 면 + 1px
  border-strong, 패딩 4 8, 왼쪽 정렬 세 줄: 이름 600("YouTube 1080p", "Shorts, Reels", "Instagram 정사각", "YouTube 4K"),
  11px secondary tabular "1920 x 1080, 30 fps, 16 Mbps"(엔진 export.resolve 값), 11px secondary 용도. 선택 = accent-subtle 면 +
  1px accent-pressed(4.7 선택과 같음). hover = 흰 면 + hover-edge. 반경 0, 그림자 없음. 고르면 프리셋 콤보도 같은 값이 된다.

## 5. Elevation

그림자는 세 가지뿐이고 짧고 옅다. 다른 곳에는 그림자가 없다.

| 토큰                 | 값              | 쓰는 곳                 |
| -------------------- | --------------- | ----------------------- |
| `--sh-shadow-raised` | 2px 2px 4px 18% | 메뉴·팝오버·툴팁·토스트 |
| `--sh-shadow-dialog` | 3px 3px 6px 22% | 대화상자                |
| `--sh-shadow-page`   | 2px 2px 0 35%   | 문서 스테이지 위 종이   |

높낮이는 그림자 대신 **베벨(볼록)과 오목 칸**으로 표현한다.

## 6. Imagery & illustration

일러스트·사진·장식 이미지를 쓰지 않는다. 이미지는 사용자의 콘텐츠(문서·의료 영상·사진)뿐이고,
`--sh-color-stage-*` 바탕 위에 보여 준다. 투명 영역은 어두운 체커(`checker-a`/`checker-b`).
제작자 얼굴 사진을 아이콘·인스톨러·UI 에 쓰지 않는다. 저작자 표기는 이름 텍스트로.

## 7. Iconography

- 16px 단색 선 아이콘, 선 두께는 화면에서 1~1.25px 고정(확대돼 2px 넘지 않게), 픽셀 격자 정렬(crispEdges).
- 색은 `currentColor`(글자색). 켜진 도구의 아이콘은 `--sh-color-accent-pressed`. 비활성 불투명도 0.35.
- 에디터처럼 아이콘이 많은 화면은 채색 픽토그램 변형을 쓸 수 있다(1px 윤곽 + 흰 면 + 강조색 면).
- 아이콘은 직접 그리거나 공개 라이선스(Lucide 등)에서 가져온다. 남의 제품 아이콘 이미지를 복사하지 않는다.

## 8. Motion

- 이동·크기 애니메이션 없음(`--sh-motion-duration-none`). 메뉴·대화상자·툴팁은 즉시 나타난다.
- hover 색 전환만 `--sh-motion-duration-fast`(100ms) 허용. 물결(ripple) 효과 없음.
- `prefers-reduced-motion` 이면 모두 0ms.

## 9. Accessibility & locale

- 키보드 포커스 = **안쪽 1px 점선 사각형**(`outline: 1px dotted var(--sh-color-text); outline-offset: -3px`).
  주 버튼 위에서는 흰 점선. `outline: none` 만 쓰고 대체 표시를 안 하는 것은 금지.
- 입력의 포커스는 accent 테두리로 표시한다(점선 없음).
- 아이콘만 있는 버튼은 툴팁과 접근성 이름을 함께 단다.
- 한국어 UI. 영어 상수·기술 용어(WebSocket, null 등)를 사용자에게 보이지 않는다. 날짜 `YYYY-MM-DD`, 시간 24시간제.
- 터치 화면(환자용 서명·키오스크)은 `touch` 테마로 크기를 키운다. 데스크톱 규격을 손가락에 강제하지 않는다.

## 10. Voice & Tone

짧고 공손한 업무 문장. "저장했습니다", "파일을 열 수 없습니다. 파일이 다른 프로그램에서 열려 있는지 확인하세요."
처럼 무엇이 일어났고 무엇을 하면 되는지 말한다.

- 느낌표·이모지·영어 혼용 금지. 원인 없는 "오류가 발생했습니다" 금지.
- UI 문구에 em-dash, en-dash, 유니코드 화살표 같은 특수기호를 쓰지 않는다. 구분은 쉼표나 하이픈(-)으로.
- 버튼 라벨은 동사: 확인 · 취소 · 저장 · 열기 · 삭제. "예/아니오" 보다 동작 이름.

## 11. Brand Narrative

이성현이 병원 전산실에서 만드는 업무 도구들(전자동의서, 서식 디자이너, 원격 지원, PDF 편집기, 메신저, 이미지 편집기,
웹에디터)의 공통 얼굴이다. 사용자는 하루 종일 같은 화면을 보는 직원이고, 그들에게 익숙한 것은 오래된 Windows 업무
프로그램이다. 그래서 새로 배울 것 없이 바로 손이 가는 화면을 만든다. 화려함보다 밀도와 예측 가능성이 신뢰를 준다.

## 12. Principles

1. **밀도가 우선이다.** 12px · 24px 컨트롤 · 22px 행. 한 화면에 더 많이 보여 준다.
2. **모양은 사각, 선은 1px.** 반경과 큰 그림자로 위계를 만들지 않는다. 베벨·오목·선으로 만든다.
3. **색은 아낀다.** 채도는 주 동작·선택·포커스·hover 테두리에만.
4. **메뉴가 기준이다.** 모든 기능은 메뉴에서 찾을 수 있고, 툴바는 지름길이다.
5. **토큰만 쓴다.** 화면 코드에 hex·px 리터럴을 새로 쓰지 않는다. 필요한 값이 없으면 sh-design-system 에 토큰을 추가한다.
6. **변형은 테마로.** 스킨·브랜드색·터치 크기는 테마를 고른다. 베이스 계약을 프로젝트에서 바꾸지 않는다.

## 13. Personas

- **병원 원무·간호 직원**: 같은 서식과 목록을 하루 수백 번 다룬다. 키보드와 우클릭을 쓴다. 화면이 바뀌는 것을 싫어한다.
- **환자(서명 화면)**: 태블릿에서 한 번 서명한다. 큰 글자·큰 버튼(`touch` 테마)이 필요하다.
- **전산 담당자(작성자)**: 여러 앱을 만들고 유지한다. 앱끼리 같은 부품·같은 단축키이길 원한다.

## 14. States

| 상태       | 표현                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| hover      | 흰 면 + 1px hover-edge (버튼·도구·입력·탭) / hover 면 (목록·표·트리 라벨) / toolbar-face (메뉴 항목)       |
| 눌림       | 베벨은 control-pressed 단색, 도구는 pressed 그라데이션 + toolbar-edge                                      |
| 켜짐(토글) | 툴바: pressed 그라데이션 + toolbar-edge + accent-pressed 아이콘 / 세그먼트·리본: accent-subtle + 진한 글자 |
| 선택       | accent-subtle + 진한 글자. 강한 선택(메뉴 키보드 선택 등)만 accent 채움 + 흰 글자                          |
| 포커스     | 안쪽 1px 점선 / 입력은 accent 테두리                                                                       |
| 비활성     | 글자 text-disabled, 아이콘 0.35, 면 sunken. 불투명도로 통째로 흐리게 하지 않는다                           |
| 오류       | danger 테두리 + 아래 11px danger 문장                                                                      |
| 빈 상태    | 회색 12px 한 문장 + 할 수 있는 동작 버튼 하나. 일러스트 없음                                               |
| 로딩       | 상태 줄 진행 막대, 버튼은 폭 유지 스피너                                                                   |

## 15. Motion & Easing

8절과 같다. 곡선 토큰을 두지 않는다. 대화상자·메뉴·툴팁 등장 애니메이션이 없으므로 이징이 필요 없다.

## 16. Do's and Don'ts

**Do**

- 메뉴바 + 툴바 + 본문 + 상태 줄의 데스크톱 골격으로 시작한다.
- 패널은 제목 띠 + 1px 테두리, 섹션은 그룹 박스(fieldset)로 나눈다.
- 툴바 항목을 세로 가운데 24px 한 줄로 맞춘다.
- 테마(스킨·브랜드·터치)를 골라 변형한다. 베이스 값을 화면 코드에서 덮지 않는다.
- 새 화면을 만들면 쇼케이스 부품과 나란히 놓고 같은지 확인한다.

**Don't**

- 둥근 모서리, pill 칩, 둥근 아바타, 카드형 대시보드, 큰 여백, 히어로 영역.
- 크고 부드러운 그림자, 유리·블러, 크롬 밖 그라데이션, 큰 마케팅 헤딩.
- Fluent·Material 기본 모양 그대로 두기 (32px 체크박스, Mica, 물결 효과, 탭 밑줄).
- 탭 선택 시 글자 굵게·크게. 트리 행 전체 칠하기, 트리에 폴더 아이콘.
- 툴바·패널에만 있는 기능. 호버해야만 보이는 버튼.
- 14px 넘는 크롬 글자, 비정수 글자 크기, letter-spacing, 대문자 변환.
- 강조 파랑을 성공·배지에 재사용. 라이트 테마 본문에 순검정.
- 화면 코드의 hex·px 리터럴. 남의 제품 이미지·아이콘·CSS 복사(수치와 배치만 참고).
- UI 문구의 em-dash, 느낌표, 이모지, 영어 상수.
