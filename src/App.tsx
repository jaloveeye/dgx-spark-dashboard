import { useEffect, useMemo, useState } from 'react';
import type { Availability, DiskReading, HistoryPoint, ProcessReading, Snapshot } from '../shared/types';

type Range = '1h' | '24h' | '7d';
const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let value = bytes; let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i > 2 ? 1 : 0)} ${units[i]}`;
};
const formatDuration = (seconds: number) => {
  const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}일 ${hours}시간` : hours ? `${hours}시간 ${minutes}분` : `${minutes}분`;
};
const colorFor = (value: number) => value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'good';

function Ring({ value, label, detail }: { value: number; label: string; detail: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return <div className="ring-wrap"><div className={`ring ${colorFor(safe)}`} style={{ '--value': safe } as React.CSSProperties}><div><strong>{safe.toFixed(0)}<small>%</small></strong><span>{label}</span></div></div><p>{detail}</p></div>;
}

function StatCard({ icon, label, value, detail, accent = false }: { icon: string; label: string; value: string; detail: string; accent?: boolean }) {
  return <article className={`stat-card ${accent ? 'accent' : ''}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function SparkChart({ points, field, color, max = 100 }: { points: HistoryPoint[]; field: keyof HistoryPoint; color: string; max?: number }) {
  const values = points.map((point) => Number(point[field])).filter(Number.isFinite);
  if (values.length < 2) return <div className="chart-empty">그래프를 만들기 위해 데이터를 수집하고 있습니다.</div>;
  const width = 700, height = 180;
  const path = values.map((value, i) => `${i ? 'L' : 'M'} ${(i / (values.length - 1)) * width} ${height - Math.min(value / max, 1) * (height - 10)}`).join(' ');
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;
  return <div className="chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><defs><linearGradient id={`fade-${field}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs><path d={area} fill={`url(#fade-${field})`}/><path d={path} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg></div>;
}

function ProcessTable({ processes, metric }: { processes: ProcessReading[]; metric: 'cpu' | 'memory' }) {
  return <div className="table-wrap"><table><thead><tr><th>프로세스</th><th>PID</th><th>{metric === 'cpu' ? 'CPU' : '메모리'}</th><th>실행 시간</th></tr></thead><tbody>{processes.map((process) => <tr key={process.pid}><td><span className="process-dot"/>{process.name}</td><td className="muted">{process.pid}</td><td><strong>{metric === 'cpu' ? `${process.cpuPercent.toFixed(1)}%` : formatBytes(process.memoryBytes)}</strong></td><td className="muted">{formatDuration(process.elapsedSeconds)}</td></tr>)}</tbody></table>{!processes.length && <div className="empty">표시할 프로세스가 없습니다.</div>}</div>;
}

function DiskRow({ disk }: { disk: DiskReading }) {
  return <div className="disk-row"><div className="disk-title"><div><strong>{disk.mount}</strong><span>{disk.device} · {disk.fsType}</span></div><b>{disk.usedPercent.toFixed(0)}%</b></div><div className="progress"><i className={colorFor(disk.usedPercent)} style={{ width: `${disk.usedPercent}%` }}/></div><small>{formatBytes(disk.usedBytes)} 사용 / {formatBytes(disk.totalBytes)}</small></div>;
}

function SoftwareItem({ label, item }: { label: string; item: Availability<string> }) {
  return <div className="software-item"><span>{label}</span><strong className={item.available ? '' : 'unavailable'}>{item.value ?? item.reason ?? '조회 불가'}</strong></div>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [range, setRange] = useState<Range>('1h');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/snapshot').then((response) => response.ok ? response.json() : Promise.reject()).then(setSnapshot).catch(() => setError('수집기가 준비 중입니다.'));
    const stream = new EventSource('/api/stream');
    stream.addEventListener('snapshot', (event) => { setSnapshot(JSON.parse((event as MessageEvent).data)); setConnected(true); setError(''); });
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, []);
  useEffect(() => {
    const load = () => fetch(`/api/history?range=${range}`).then((response) => response.json()).then(setHistory).catch(() => setError('이력을 불러오지 못했습니다.'));
    load(); const timer = setInterval(load, 60_000); return () => clearInterval(timer);
  }, [range, snapshot?.timestamp]);

  const memoryPercent = snapshot ? snapshot.memory.usedBytes / snapshot.memory.totalBytes * 100 : 0;
  const maxSystemTemp = useMemo(() => snapshot?.temperatures.length ? Math.max(...snapshot.temperatures.map((t) => t.celsius)) : null, [snapshot]);
  if (!snapshot) return <main className="loading"><div className="loader"/><h1>DGX 상태를 불러오는 중</h1><p>{error || '첫 번째 지표를 수집하고 있습니다.'}</p></main>;

  return <div className="app-shell">
    <header><div className="brand"><div className="brand-mark">D</div><div><h1>DGX 관제 센터</h1><p>{snapshot.hostname} · {snapshot.software.os.value ?? snapshot.software.os.reason}</p></div></div><div className="header-status"><span className={connected ? 'online' : 'offline'}>{connected ? '실시간 연결' : '재연결 중'}</span><div><b>{new Date(snapshot.timestamp).toLocaleTimeString('ko-KR')}</b><small>마지막 업데이트</small></div></div></header>
    <main>
      {snapshot.errors.length > 0 && <div className="alert">일부 지표를 사용할 수 없습니다: {snapshot.errors.join(' · ')}</div>}
      <section className="hero"><div><p className="eyebrow">SYSTEM OVERVIEW</p><h2>시스템이 <em>{snapshot.errors.length ? '일부 제한 상태' : '정상 작동'}</em> 중입니다</h2><p>{snapshot.cpu.cores}코어 · 가동 시간 {formatDuration(snapshot.uptimeSeconds)}</p></div><div className="hero-meta"><span>LOAD 1M</span><strong>{snapshot.cpu.load1.toFixed(2)}</strong></div></section>
      <section className="stat-grid">
        <StatCard icon="◈" label="GPU 온도" value={snapshot.gpu.value?.temperatureCelsius != null ? `${snapshot.gpu.value.temperatureCelsius.toFixed(0)}°C` : '—'} detail={snapshot.gpu.value?.name ?? 'GPU 없음'} accent/>
        <StatCard icon="⌁" label="시스템 온도" value={maxSystemTemp != null ? `${maxSystemTemp.toFixed(0)}°C` : '—'} detail={`${snapshot.temperatures.length}개 센서`} />
        <StatCard icon="▣" label="메모리 사용" value={formatBytes(snapshot.memory.usedBytes)} detail={`전체 ${formatBytes(snapshot.memory.totalBytes)}`} />
        <StatCard icon="↕" label="네트워크" value={formatBytes(snapshot.network.reduce((sum, n) => sum + n.rxBytesPerSecond + n.txBytesPerSecond, 0)) + '/s'} detail={`${snapshot.network.length}개 인터페이스`} />
      </section>
      <section className="panel usage-panel"><div className="panel-title"><div><p className="eyebrow">RESOURCE USAGE</p><h3>현재 자원 사용량</h3></div><span>15초 간격</span></div><div className="rings"><Ring value={snapshot.cpu.usagePercent} label="CPU" detail={`${snapshot.cpu.cores}개 논리 코어`}/><Ring value={memoryPercent} label="메모리" detail={`${formatBytes(snapshot.memory.availableBytes)} 사용 가능`}/><Ring value={snapshot.gpu.value?.utilizationPercent ?? 0} label="GPU" detail={snapshot.gpu.value?.performanceState ?? '사용 불가'}/><Ring value={snapshot.disks[0]?.usedPercent ?? 0} label="저장소" detail={`${formatBytes(snapshot.disks[0]?.availableBytes ?? 0)} 여유`}/></div></section>
      <section className="panel history-panel"><div className="panel-title"><div><p className="eyebrow">HISTORY</p><h3>사용량 추세</h3></div><div className="range-tabs">{(['1h','24h','7d'] as Range[]).map((item) => <button className={range === item ? 'active' : ''} onClick={() => setRange(item)} key={item}>{item === '1h' ? '1시간' : item === '24h' ? '24시간' : '7일'}</button>)}</div></div><div className="chart-grid"><div><div className="chart-label"><span><i style={{background:'#76b900'}}/>CPU</span><b>{snapshot.cpu.usagePercent.toFixed(1)}%</b></div><SparkChart points={history} field="cpuPercent" color="#76b900"/></div><div><div className="chart-label"><span><i style={{background:'#a78bfa'}}/>메모리</span><b>{memoryPercent.toFixed(1)}%</b></div><SparkChart points={history} field="memoryPercent" color="#a78bfa"/></div></div></section>
      <section className="two-column"><article className="panel"><div className="panel-title"><div><p className="eyebrow">STORAGE</p><h3>저장소</h3></div></div><div className="disk-list">{snapshot.disks.map((disk) => <DiskRow disk={disk} key={`${disk.device}-${disk.mount}`}/>)}</div></article><article className="panel"><div className="panel-title"><div><p className="eyebrow">GPU WORKLOADS</p><h3>GPU 작업</h3></div><span>{snapshot.gpuProcesses.length}개 활성</span></div>{snapshot.gpuProcesses.map((process) => <div className="gpu-job" key={process.pid}><div><span className="pulse"/><div><strong>{process.name}</strong><small>PID {process.pid}</small></div></div><b>{process.gpuMemoryMiB?.toLocaleString()} MiB</b></div>)}{!snapshot.gpuProcesses.length && <div className="empty tall">현재 GPU 작업이 없습니다.</div>}<p className="memory-note">{snapshot.gpu.value?.memoryNote}</p></article></section>
      <section className="panel software-panel"><div className="panel-title"><div><p className="eyebrow">SOFTWARE ENVIRONMENT</p><h3>소프트웨어 환경</h3></div><span>서비스 시작 시 확인</span></div><div className="software-grid"><SoftwareItem label="운영체제" item={snapshot.software.os}/><SoftwareItem label="커널" item={snapshot.software.kernel}/><SoftwareItem label="NVIDIA 드라이버" item={snapshot.software.nvidiaDriver}/><SoftwareItem label="CUDA 지원" item={snapshot.software.cudaSupport}/><SoftwareItem label="Node.js" item={snapshot.software.node}/><SoftwareItem label="대시보드" item={snapshot.software.dashboard}/></div><details className="software-details"><summary>추가 런타임 정보</summary><div className="software-grid secondary"><SoftwareItem label="NVIDIA-SMI" item={snapshot.software.nvidiaSmi}/><SoftwareItem label="CUDA Toolkit" item={snapshot.software.cudaToolkit}/><SoftwareItem label="Python" item={snapshot.software.python}/><SoftwareItem label="Docker" item={snapshot.software.docker}/><SoftwareItem label="NVIDIA Container Toolkit" item={snapshot.software.nvidiaContainerToolkit}/></div></details></section>
      <section className="two-column"><article className="panel"><div className="panel-title"><div><p className="eyebrow">TOP PROCESSES</p><h3>CPU 사용량 Top 5</h3></div></div><ProcessTable processes={snapshot.topCpu} metric="cpu"/></article><article className="panel"><div className="panel-title"><div><p className="eyebrow">TOP PROCESSES</p><h3>메모리 사용량 Top 5</h3></div></div><ProcessTable processes={snapshot.topMemory} metric="memory"/></article></section>
    </main><footer><span>DGX 관제 센터 · 조회 전용</span><span>7일간 지표 보존</span></footer>
  </div>;
}
