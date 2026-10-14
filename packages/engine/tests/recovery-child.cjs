// 자동 저장 복구 테스트의 "죽는 세션". 별도 프로세스로 돌아야 복구 후보가 살아 있는 세션으로 보이지 않는다.
// 인자: <dataDir> <projectName>. 복구 저널이 쓰일 때까지 기다린 뒤 shutdown 없이 종료한다(크래시 흉내).
const path = require('node:path');
const engineModule = require(path.resolve(__dirname, '..', 'bindings', 'napi'));

const [dataDir, projectName] = process.argv.slice(2);
const T = 254_016_000_000;
const engine = new engineModule.Engine();
const exec = (id, params) => JSON.parse(engine.execute(id, params ? JSON.stringify(params) : undefined));

engine.startAutosave(dataDir, 0);
exec('prefs.set', { key: 'autoSave.recoveryIntervalSeconds', value: 1 });
exec('file.newProject', { name: projectName });
exec('file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
const demo = exec('file.importDemoFootage', { scene: 'Dunes' });
exec('timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
exec('timeline.razor', { time: 3 * T });

const started = Date.now();
const wait = () => {
  engine.pollPersistence();
  const status = exec('file.autoSaveStatus');
  if (status.status.journalsWritten > 0 && status.status.journaledRevision > 0) {
    process.stdout.write(
      JSON.stringify({ ok: true, revision: status.status.journaledRevision, sessionDir: status.sessionDir }),
    );
    // shutdown 을 부르지 않고 바로 죽는다
    process.exit(0);
  }
  if (Date.now() - started > 20_000) {
    process.stdout.write(JSON.stringify({ ok: false, status }));
    process.exit(2);
  }
  setTimeout(wait, 100);
};
wait();
