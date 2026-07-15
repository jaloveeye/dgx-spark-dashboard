import { useEffect, useMemo, useState } from 'react';
import type { Availability, DiskReading, HistoryPoint, ProcessReading, Snapshot, UpdateInfo } from '../shared/types';
import { formatBytes } from './format';
import { createTranslator, initialLocale, localizeAvailabilityReason, localizeCollectorError, type Locale } from './i18n';

type Range = '1h' | '24h' | '7d';
type Translator = ReturnType<typeof createTranslator>;
type Theme = 'system' | 'dark' | 'light';
interface SessionState { authenticated: boolean; username?: string }

const initialTheme = (): Theme => {
  try { const saved = localStorage.getItem('dgx-dashboard-theme'); if (saved === 'system' || saved === 'dark' || saved === 'light') return saved; } catch { /* storage may be disabled */ }
  return 'system';
};

const formatDuration = (seconds: number, t: Translator) => {
  const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  return days ? t('dayHour', { days, hours }) : hours ? t('hourMinute', { hours, minutes }) : t('minute', { minutes });
};

const colorFor = (value: number) => value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'good';

function Ring({ value, label, detail }: { value: number; label: string; detail: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return <div className="ring-wrap"><div className={`ring ${colorFor(safe)}`} style={{ '--value': safe } as React.CSSProperties}><div><strong>{safe.toFixed(0)}<small>%</small></strong><span>{label}</span></div></div><p>{detail}</p></div>;
}

function StatCard({ icon, label, value, detail, accent = false }: { icon: string; label: string; value: string; detail: string; accent?: boolean }) {
  return <article className={`stat-card ${accent ? 'accent' : ''}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function SparkChart({ points, field, color, emptyText, max = 100 }: { points: HistoryPoint[]; field: keyof HistoryPoint; color: string; emptyText: string; max?: number }) {
  const values = points.map((point) => Number(point[field])).filter(Number.isFinite);
  if (values.length < 2) return <div className="chart-empty">{emptyText}</div>;
  const width = 700, height = 180;
  const path = values.map((value, i) => `${i ? 'L' : 'M'} ${(i / (values.length - 1)) * width} ${height - Math.min(value / max, 1) * (height - 10)}`).join(' ');
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;
  return <div className="chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><defs><linearGradient id={`fade-${field}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs><path d={area} fill={`url(#fade-${field})`}/><path d={path} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg></div>;
}

function ProcessTable({ processes, metric, t }: { processes: ProcessReading[]; metric: 'cpu' | 'memory'; t: Translator }) {
  return <div className="table-wrap"><table><thead><tr><th>{t('process')}</th><th>PID</th><th>{metric === 'cpu' ? 'CPU' : t('memory')}</th><th>{t('elapsed')}</th></tr></thead><tbody>{processes.map((process) => <tr key={process.pid}><td><span className="process-dot"/>{process.name}</td><td className="muted">{process.pid}</td><td><strong>{metric === 'cpu' ? `${process.cpuPercent.toFixed(1)}%` : formatBytes(process.memoryBytes)}</strong></td><td className="muted">{formatDuration(process.elapsedSeconds, t)}</td></tr>)}</tbody></table>{!processes.length && <div className="empty">{t('noProcesses')}</div>}</div>;
}

function DiskRow({ disk, t }: { disk: DiskReading; t: Translator }) {
  return <div className="disk-row"><div className="disk-title"><div><strong>{disk.mount}</strong><span>{disk.device} · {disk.fsType}</span></div><b>{disk.usedPercent.toFixed(0)}%</b></div><div className="progress"><i className={colorFor(disk.usedPercent)} style={{ width: `${disk.usedPercent}%` }}/></div><small>{t('usedOfTotal', { used: formatBytes(disk.usedBytes), total: formatBytes(disk.totalBytes) })}</small></div>;
}

function SoftwareItem({ label, item, locale, t }: { label: string; item: Availability<string>; locale: Locale; t: Translator }) {
  return <div className="software-item"><span>{label}</span><strong className={item.available ? '' : 'unavailable'}>{item.value ?? localizeAvailabilityReason(item.reason, locale) ?? t('lookupUnavailable')}</strong></div>;
}

function UpdatePanel({ info, loading, error, managementUrl, locale, t, onRefresh }: { info: UpdateInfo | null; loading: boolean; error: boolean; managementUrl: string; locale: Locale; t: Translator; onRefresh: () => void }) {
  const cacheTime = info?.packageCacheUpdatedAt ? new Date(info.packageCacheUpdatedAt).toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US') : null;
  const heading = loading && !info ? t('checkingUpdates') : error && !info ? t('updateCheckFailed') : info?.available ? t('updatesAvailable', { count: info.totalCount }) : t('systemUpToDate');
  const detail = info?.available ? t('updatesAvailableDetail', { security: info.securityCount, dgx: info.dgxNvidiaCount }) : t('systemUpToDateDetail');
  return <section className={`panel update-panel ${info?.available ? 'has-updates' : ''}`}>
    <div className="update-summary">
      <div className="update-symbol" aria-hidden="true">{loading ? '…' : info?.available ? '↥' : '✓'}</div>
      <div className="update-copy"><p className="eyebrow">{t('updatesEyebrow')}</p><h3>{heading}</h3>{!(error && !info) && <p>{detail}</p>}<small>{cacheTime ? t('packageCacheUpdated', { time: cacheTime }) : t('cachedPackageData')}</small></div>
    </div>
    <div className="update-actions">
      {info?.rebootRequired && <span className="update-badge warning">{t('rebootRequired')}</span>}
      <button className="secondary-action" onClick={onRefresh} disabled={loading}>{loading ? t('checkingUpdates') : t('checkAgain')}</button>
      {info?.available && <a className="primary-action" href={managementUrl} target="_blank" rel="noreferrer">{t('openUpdatePage')} ↗</a>}
    </div>
    {info?.available && <details className="update-details"><summary>{t('updateDetails', { count: info.totalCount })}</summary><div className="update-table-wrap"><table><thead><tr><th>{t('updatePackage')}</th><th>{t('currentVersion')}</th><th>{t('availableVersion')}</th></tr></thead><tbody>{info.packages.map((item) => <tr key={`${item.name}-${item.architecture}`}><td><strong>{item.name}</strong><span className="package-labels">{item.security && <i>{t('securityUpdate')}</i>}{item.dgxNvidia && <i>{t('dgxNvidiaUpdate')}</i>}</span></td><td className="muted">{item.currentVersion}</td><td>{item.availableVersion}</td></tr>)}</tbody></table></div></details>}
  </section>;
}

function PreferenceControls({ locale, setLocale, theme, setTheme, t }: { locale: Locale; setLocale: (locale: Locale) => void; theme: Theme; setTheme: (theme: Theme) => void; t: Translator }) {
  return <div className="preferences"><div className="language-switch" role="group" aria-label={t('language')}><button className={locale === 'ko' ? 'active' : ''} aria-pressed={locale === 'ko'} onClick={() => setLocale('ko')}>한국어</button><button className={locale === 'en' ? 'active' : ''} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button></div><label className="theme-select" title={t('theme')}><span aria-hidden="true">◐</span><select aria-label={t('theme')} value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="system">{t('themeSystem')}</option><option value="dark">{t('themeDark')}</option><option value="light">{t('themeLight')}</option></select></label></div>;
}

function LoginView({ locale, setLocale, theme, setTheme, t, onAuthenticated }: { locale: Locale; setLocale: (locale: Locale) => void; theme: Theme; setTheme: (theme: Theme) => void; t: Translator; onAuthenticated: (session: SessionState) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const body = await response.json() as { authenticated?: boolean; username?: string; error?: string };
      if (response.ok && body.authenticated && body.username) onAuthenticated({ authenticated: true, username: body.username });
      else setError(response.status === 429 ? t('tooManyAttempts') : t('invalidCredentials'));
    } catch {
      setError(t('loginUnavailable'));
    } finally {
      setPassword(''); setSubmitting(false);
    }
  };

  return <main className="login-page"><div className="login-preferences"><PreferenceControls locale={locale} setLocale={setLocale} theme={theme} setTheme={setTheme} t={t}/></div><section className="login-card"><div className="login-brand"><div className="brand-mark">D</div><div><h1>{t('signInTitle')}</h1><p>{t('signInSubtitle')}</p></div></div><form onSubmit={submit}><label><span>{t('username')}</span><input name="username" autoComplete="username" autoFocus required maxLength={64} value={username} onChange={(event) => setUsername(event.target.value)}/></label><label><span>{t('password')}</span><input name="password" type="password" autoComplete="current-password" required maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)}/></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="login-submit" disabled={submitting}>{submitting ? t('signingIn') : t('signIn')}</button></form></section></main>;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => initialLocale());
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const [authState, setAuthState] = useState<SessionState | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [range, setRange] = useState<Range>('1h');
  const [connected, setConnected] = useState(false);
  const [errorKind, setErrorKind] = useState<'collector' | 'history' | null>(null);
  const [updates, setUpdates] = useState<UpdateInfo | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesError, setUpdatesError] = useState(false);
  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('appTitle');
    try { localStorage.setItem('dgx-dashboard-locale', locale); } catch { /* storage may be disabled */ }
  }, [locale, t]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    if (theme === 'system') media.addEventListener('change', applyTheme);
    try { localStorage.setItem('dgx-dashboard-theme', theme); } catch { /* storage may be disabled */ }
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    fetch('/api/session').then((response) => response.json()).then((session: SessionState) => setAuthState(session)).catch(() => setAuthState({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!authState?.authenticated) return;
    fetch('/api/snapshot').then((response) => {
      if (response.status === 401) { setAuthState({ authenticated: false }); throw new Error('unauthorized'); }
      return response.ok ? response.json() : Promise.reject();
    }).then(setSnapshot).catch(() => setErrorKind('collector'));
    const stream = new EventSource('/api/stream');
    stream.addEventListener('snapshot', (event) => { setSnapshot(JSON.parse((event as MessageEvent).data)); setConnected(true); setErrorKind(null); });
    stream.onerror = () => {
      setConnected(false);
      fetch('/api/session').then((response) => response.json()).then((session: SessionState) => { if (!session.authenticated) setAuthState(session); }).catch(() => {});
    };
    return () => stream.close();
  }, [authState?.authenticated]);

  useEffect(() => {
    if (!authState?.authenticated) return;
    const load = () => fetch(`/api/history?range=${range}`).then((response) => {
      if (response.status === 401) { setAuthState({ authenticated: false }); throw new Error('unauthorized'); }
      return response.ok ? response.json() : Promise.reject();
    }).then(setHistory).catch(() => setErrorKind('history'));
    load(); const timer = setInterval(load, 60_000); return () => clearInterval(timer);
  }, [authState?.authenticated, range, snapshot?.timestamp]);

  const loadUpdates = async (refresh = false) => {
    if (!authState?.authenticated || updatesLoading) return;
    setUpdatesLoading(true); setUpdatesError(false);
    try {
      const response = await fetch(`/api/updates${refresh ? '?refresh=1' : ''}`);
      if (response.status === 401) { setAuthState({ authenticated: false }); return; }
      if (!response.ok) throw new Error('update check failed');
      setUpdates(await response.json() as UpdateInfo);
    } catch {
      setUpdatesError(true);
    } finally {
      setUpdatesLoading(false);
    }
  };

  useEffect(() => {
    if (authState?.authenticated) void loadUpdates();
  }, [authState?.authenticated]);

  const memoryPercent = snapshot ? snapshot.memory.usedBytes / snapshot.memory.totalBytes * 100 : 0;
  const maxSystemTemp = useMemo(() => snapshot?.temperatures.length ? Math.max(...snapshot.temperatures.map((reading) => reading.celsius)) : null, [snapshot]);
  const rangeLabel = (item: Range) => item === '1h' ? t('oneHour') : item === '24h' ? t('twentyFourHours') : t('sevenDays');
  const updateManagementUrl = updates?.managementUrl ?? `http://${window.location.hostname}:11000/updates`;

  if (authState === null) return <main className="loading"><div className="loader"/><h1>{t('appTitle')}</h1><p>{t('sessionChecking')}</p></main>;
  if (!authState.authenticated) return <LoginView locale={locale} setLocale={setLocale} theme={theme} setTheme={setTheme} t={t} onAuthenticated={(session) => { setSnapshot(null); setHistory([]); setAuthState(session); }}/>;
  if (!snapshot) return <main className="loading"><div className="loader"/><h1>{t('loadingTitle')}</h1><p>{errorKind === 'collector' ? t('collectorPreparing') : t('collectingFirst')}</p></main>;

  const softwareItem = (label: string, item: Availability<string>) => <SoftwareItem label={label} item={item} locale={locale} t={t}/>;
  const logout = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } finally {
      setSnapshot(null); setHistory([]); setUpdates(null); setConnected(false); setAuthState({ authenticated: false });
    }
  };

  return <div className="app-shell">
    <header><div className="brand"><div className="brand-mark">D</div><div><h1>{t('appTitle')}</h1><p>{snapshot.hostname} · {snapshot.software.os.value ?? localizeAvailabilityReason(snapshot.software.os.reason, locale)}</p></div></div><div className="header-status"><PreferenceControls locale={locale} setLocale={setLocale} theme={theme} setTheme={setTheme} t={t}/><div className="auth-user"><span>{authState.username}</span><button onClick={logout}>{t('logout')}</button></div><span className={connected ? 'online' : 'offline'}>{connected ? t('connected') : t('reconnecting')}</span><div className="header-clock"><b>{new Date(snapshot.timestamp).toLocaleTimeString(locale === 'ko' ? 'ko-KR' : 'en-US')}</b><small>{t('lastUpdate')}</small></div></div></header>
    <main>
      {snapshot.errors.length > 0 && <div className="alert">{t('metricsUnavailable')} {snapshot.errors.map((item) => localizeCollectorError(item, locale)).join(' · ')}</div>}
      <section className="hero"><div><p className="eyebrow">{t('systemOverview')}</p><h2>{t('systemPrefix')} <em>{t(snapshot.errors.length ? 'systemDegraded' : 'systemNormal')}</em>{t('systemSuffix') ? ` ${t('systemSuffix')}` : ''}</h2><p>{t('coresUptime', { cores: snapshot.cpu.cores, duration: formatDuration(snapshot.uptimeSeconds, t) })}</p></div><div className="hero-meta"><span>{t('load1m')}</span><strong>{snapshot.cpu.load1.toFixed(2)}</strong></div></section>
      <UpdatePanel info={updates} loading={updatesLoading} error={updatesError} managementUrl={updateManagementUrl} locale={locale} t={t} onRefresh={() => void loadUpdates(true)}/>
      <section className="stat-grid">
        <StatCard icon="◈" label={t('gpuTemperature')} value={snapshot.gpu.value?.temperatureCelsius != null ? `${snapshot.gpu.value.temperatureCelsius.toFixed(0)}°C` : '—'} detail={snapshot.gpu.value?.name ?? t('noGpu')} accent/>
        <StatCard icon="⌁" label={t('systemTemperature')} value={maxSystemTemp != null ? `${maxSystemTemp.toFixed(0)}°C` : '—'} detail={t('sensors', { count: snapshot.temperatures.length })}/>
        <StatCard icon="▣" label={t('memoryUsage')} value={formatBytes(snapshot.memory.usedBytes)} detail={t('memoryCapacityDetail', { value: formatBytes(snapshot.memory.totalBytes) })}/>
        <StatCard icon="↕" label={t('network')} value={formatBytes(snapshot.network.reduce((sum, item) => sum + item.rxBytesPerSecond + item.txBytesPerSecond, 0)) + '/s'} detail={t('interfaces', { count: snapshot.network.length })}/>
      </section>
      <section className="panel usage-panel"><div className="panel-title"><div><p className="eyebrow">{t('resourceUsage')}</p><h3>{t('currentUsage')}</h3></div><span>{t('every15Seconds')}</span></div><div className="rings"><Ring value={snapshot.cpu.usagePercent} label="CPU" detail={t('logicalCoresAverage', { count: snapshot.cpu.cores })}/><Ring value={memoryPercent} label={t('memory')} detail={t('availableMemory', { value: formatBytes(snapshot.memory.availableBytes) })}/><Ring value={snapshot.gpu.value?.utilizationPercent ?? 0} label="GPU" detail={snapshot.gpu.value?.performanceState ?? t('unavailable')}/><Ring value={snapshot.disks[0]?.usedPercent ?? 0} label={t('storage')} detail={t('freeSpace', { value: formatBytes(snapshot.disks[0]?.availableBytes ?? 0) })}/></div></section>
      <section className="panel history-panel"><div className="panel-title"><div><p className="eyebrow">{t('history')}</p><h3>{t('usageTrend')}</h3></div><div className="range-tabs">{(['1h','24h','7d'] as Range[]).map((item) => <button className={range === item ? 'active' : ''} onClick={() => setRange(item)} key={item}>{rangeLabel(item)}</button>)}</div></div><div className="chart-grid"><div><div className="chart-label"><span><i style={{background:'#76b900'}}/>CPU</span><b>{snapshot.cpu.usagePercent.toFixed(1)}%</b></div><SparkChart points={history} field="cpuPercent" color="#76b900" emptyText={t('chartCollecting')}/></div><div><div className="chart-label"><span><i style={{background:'#a78bfa'}}/>{t('memory')}</span><b>{memoryPercent.toFixed(1)}%</b></div><SparkChart points={history} field="memoryPercent" color="#a78bfa" emptyText={t('chartCollecting')}/></div></div></section>
      <section className="two-column"><article className="panel"><div className="panel-title"><div><p className="eyebrow">STORAGE</p><h3>{t('storage')}</h3></div></div><div className="disk-list">{snapshot.disks.map((disk) => <DiskRow disk={disk} t={t} key={`${disk.device}-${disk.mount}`}/>)}</div></article><article className="panel"><div className="panel-title"><div><p className="eyebrow">{t('gpuWorkloads')}</p><h3>{t('gpuJobs')}</h3></div><span>{t('activeCount', { count: snapshot.gpuProcesses.length })}</span></div>{snapshot.gpuProcesses.map((process) => <div className="gpu-job" key={process.pid}><div><span className="pulse"/><div><strong>{process.name}</strong><small>PID {process.pid}</small></div></div><b>{process.gpuMemoryMiB?.toLocaleString()} MiB</b></div>)}{!snapshot.gpuProcesses.length && <div className="empty tall">{t('noGpuJobs')}</div>}<p className="memory-note">{t('unifiedMemoryNote')}</p></article></section>
      <section className="panel software-panel"><div className="panel-title"><div><p className="eyebrow">{t('softwareEnvironmentEyebrow')}</p><h3>{t('softwareEnvironment')}</h3></div><span>{t('checkedAtStartup')}</span></div><div className="software-grid">{softwareItem(t('operatingSystem'), snapshot.software.os)}{softwareItem(t('kernel'), snapshot.software.kernel)}{softwareItem(t('nvidiaDriver'), snapshot.software.nvidiaDriver)}{softwareItem(t('cudaSupport'), snapshot.software.cudaSupport)}{softwareItem('Node.js', snapshot.software.node)}{softwareItem(t('dashboard'), snapshot.software.dashboard)}</div><details className="software-details"><summary>{t('additionalRuntime')}</summary><div className="software-grid secondary">{softwareItem('NVIDIA-SMI', snapshot.software.nvidiaSmi)}{softwareItem('CUDA Toolkit', snapshot.software.cudaToolkit)}{softwareItem('Python', snapshot.software.python)}{softwareItem('Docker', snapshot.software.docker)}{softwareItem('NVIDIA Container Toolkit', snapshot.software.nvidiaContainerToolkit)}</div></details></section>
      <section className="two-column"><article className="panel"><div className="panel-title"><div><p className="eyebrow">{t('topProcesses')}</p><h3>{t('cpuTopFive')}</h3></div></div><ProcessTable processes={snapshot.topCpu} metric="cpu" t={t}/></article><article className="panel"><div className="panel-title"><div><p className="eyebrow">{t('topProcesses')}</p><h3>{t('memoryTopFive')}</h3></div></div><ProcessTable processes={snapshot.topMemory} metric="memory" t={t}/></article></section>
    </main><footer><span>{t('readOnly')}</span><span>{t('retention')}</span></footer>
  </div>;
}
