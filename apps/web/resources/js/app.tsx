import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import confetti from 'canvas-confetti';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, FileText, Globe2, Linkedin, LoaderCircle, LockKeyhole, LogOut, MonitorSmartphone, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { ReportPage, type Report } from './report';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import '../css/app.css';

type Scan = { id: string; url: string; status: string; phase: string; error?: string | null; created_at: string };
type Draft = { url: string; authorized: boolean; active: boolean; formSubmissionTesting: boolean; pending: boolean };
type ScanLimits = { isAdmin: boolean; userScansToday: number; userScansLimit: number | null; totalScansToday: number; totalScansLimit: number | null };
type TopSite = { title: string; url: string; score: number };
type PageData = { user: { name: string } | null; uniqueSites: number; scans: Scan[]; topSites: TopSite[]; authError: string | null; oidcConfigured: boolean; csrfToken: string; scanLimits: ScanLimits | null; report?: Report };
type TooltipPos = { x: number; y: number; visible: boolean; text?: string };
declare global { interface Window { quickscan: PageData } }
const page = window.quickscan;
const draftKey = 'quickscan-submission';
const tooltipTotal = 10;
const makerHint = 'Timo Klabbers. Werkt ook zonder wifi, maar minder graag.';
function readDraft(): Draft {
	try {
		const value = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
		if (value && typeof value.url === 'string') return { url: value.url, authorized: value.authorized === true, active: value.active === true, formSubmissionTesting: value.formSubmissionTesting === true, pending: value.pending === true };
	} catch {}
	return { url: '', authorized: false, active: false, formSubmissionTesting: false, pending: false };
}
const initialDraft = readDraft();
const phaseNames: Record<string, string> = {
	queued: 'In de wachtrij', capturing_homepage: 'Website en screenshots ophalen', selecting_pages: 'Pagina\'s selecteren',
	capturing_pages: 'Pagina\'s bekijken', running_technical_checks: 'Techniek controleren', evaluating_ai: 'Bezoekerservaring beoordelen',
	generating_report: 'Rapport samenstellen', completed: 'Rapport klaar', failed: 'Scan niet afgerond',
};
const checks = [
	{ icon: ShieldCheck, color: 'lime', number: '01', title: 'De techniek', method: 'HTTP, TLS & metadata', text: 'Als eerste kijkt het systeem naar de technische kant. Is de verbinding beveiligd? Zijn er goede headers ingesteld? En heeft je website metadata?', tags: ['Veiligheid', 'Vindbaarheid'] },
	{ icon: MonitorSmartphone, color: 'aqua', number: '02', title: 'De website bezoeken', method: 'Google Chrome op desktop & mobiel', text: 'Het systeem bezoekt de homepage en maximaal drie relevante pagina\'s. Screenshots, mobiele bediening, formulierlabels, alt-teksten, links en afbeeldingen worden gecontroleerd.', tags: ['Mobiel', 'Toegankelijkheid'] },
	{ icon: Sparkles, color: 'yellow', number: '03', title: 'Door de ogen van een bezoeker', method: 'AI-analyse met Google Gemini', text: 'Acht criteria opgesteld door communicatie-specialisten voor onder meer beeldgebruik, kennismaken, actualiteit, contact en vrijwilligerswerving. Hiervoor gebruikt het systeem zichtbare tekst en screenshots van je website.', tags: ['Inhoud', 'Scoutingbeleving'] },
	{ icon: Search, color: 'coral', number: '04', title: 'De snelheid en veiligheid', method: 'PageSpeed & bestandschecks', text: 'Google PageSpeed meet mobiele prestaties. Met jouw extra toestemming controleren we enkele bekende locaties op blootgestelde configuratiebestanden.', tags: ['Snelheid', 'Hack-proof'] },
];
const checkHints: Record<string, string> = {
	'01': 'Ook achter een mooie homepage kan een kabel loszitten.',
	'02': 'Past je website in een broekzak?',
	'03': 'Snapt een bezoeker het ook zonder tien jaar Scoutingervaring?',
	'04': 'Laden mag. Maar liever niet tot na zomerkamp.',
};
const faqs = [
	['Voor wie is de Quickscan?', 'Voor leden van Scouting Nederland die hun Scoutingwebsite willen verbeteren. Om een scan te starten meld je je aan via SOL 3.0. Je mag alleen websites scannen waarvoor je toestemming hebt.'],
    ['Waarom moet ik inloggen met SOL 3.0?', 'Deze website is gemaakt voor leden van Scouting Nederland. Elke scan kost een klein bedrag. Dat is geen probleem zolang het aantal scan beperkt blijft. Om te zorgen dat de capaciteit beschikbaar blijft voor scouts vraag ik je in te loggen.'],
	['Hoe werkt een scan precies?', 'Het systeem begint met het opzoeken en openen van je website. Dan download het systeem de homepagina en maakt screenshots. Op basis van navigatieteksten selelecteert het systeem maximaal drie pagina\'s, zoals contact, speltakken en vrijwilligers. Daarna volgen automatische technische controles en worden de pagina\'s, samen met een scoretabel naar een AI-model van Google gestuurd. Het AI-model beoordeeld de website op basis van de best-practices die ik heb opgesteld en geeft een score en een advies Je ontvangt een rapport met concrete vervolgstappen.'],
	['Hoe lang duurt het en kan ik de pagina sluiten?', 'Een scan duurt meestal enkele minuten, afhankelijk van de website en beschikbare capaciteit. Scans staan in een wachtrij en gaan op de achtergrond verder. Na opnieuw aanmelden zie je je tien meest recente scans. Per account kunnen maximaal drie scans tegelijk in behandeling zijn.'],
	['Is dit een volledige veiligheids- of toegankelijkheidsaudit?', 'Nee. Dit is een geautomatiseerde quickscan op een beperkte selectie pagina\'s. Hij vervangt geen audit, pentest of beoordeling door een specialist. AI kan zich vergissen en het systeem probeert je website niet te hacken, het kijkt alleen naar openbare gegevens.'],
	['Wat gebeurt er met mijn gegevens?', 'Je rapporten zijn alleen toegankelijk vanuit jouw aangemelde account. We bewaren je accountkoppeling, scanstatus en rapporten. Alleen als je zelf je score deelt, worden de sitenaam, websitelink en score openbaar voor de top 10. Je rapport en accountgegevens blijven privé. Ook worden websitetekst, screenshots en de link van de website naar Google gestuurd voor een analyse met AI en onderzoek voor de snelheid van de website. De scan werkt alleen met pagina\'s van je website dit openbaar staan, dus waarschijnlijk heeft Google deze gegevens toch al.'],
	['Hoe wordt de gewogen score berekend?', 'Techniek en bezoekerservaring tellen elk voor 50% mee. We nemen het gemiddelde van de beoordeelde technische checks en rekenen het gemiddelde van de AI-scores om naar een percentage. Checks die niet beschikbaar zijn en criteria met onvoldoende bewijs tellen niet mee. Een totaalscore is pas beschikbaar als beide onderdelen beoordeeld zijn. Alleen vrijwillig gedeelde scores komen in aanmerking voor de top 10. Elke website staat maximaal één keer in de lijst; de laatst gedeelde score vervangt de eerdere score.'],
	['Kan iedereen mijn rapport openen via de link?', 'Nee. Ook met de rapportlink moet je zijn aangemeld als de gebruiker die de scan heeft aangevraagd. Je kunt zelf het rapport printen als pdf en met je webbeheerder delen.'],
	['Wat kan ik doen als ik meer wil leren?', 'Je kunt andere quickscan tools gebruiken om je website verder te analyseren en te verbeteren. Daarnaast kun je Team CMS van Scouting Nederland benaderen voor specialistisch advies via cms@ti.scouting.nl']
];

function App() {
	const [url, setUrl] = useState(initialDraft.url);
	const [authorized, setAuthorized] = useState(initialDraft.authorized);
	const [active, setActive] = useState(initialDraft.active);
	const [formSubmissionTesting, setFormSubmissionTesting] = useState(initialDraft.formSubmissionTesting);
	const [scans, setScans] = useState(page.scans);
	const [uniqueSites, setUniqueSites] = useState(page.uniqueSites);
	const [busy, setBusy] = useState(false);
	const [scanSetupOpen, setScanSetupOpen] = useState(false);
	const [duplicateDraft, setDuplicateDraft] = useState<Draft | null>(null);
	const [scanToReveal, setScanToReveal] = useState<string | null>(null);
	const historyTitle = useRef<HTMLHeadingElement>(null);
	const [error, setError] = useState(page.authError ?? '');
	const [expired, setExpired] = useState(false);
	const [pollingError, setPollingError] = useState(false);
	const [tooltipPos, setTooltipPos] = useState<TooltipPos>({ x: 0, y: 0, visible: false });
	const [discoveredHints, setDiscoveredHints] = useState<Set<string>>(() => new Set());
	const celebratedHints = useRef(false);
	const signedIn = !!page.user && !expired;

	useEffect(() => {
		if (!tooltipPos.visible) return;
		const text = tooltipPos.text ?? makerHint;
		setDiscoveredHints(current => current.has(text) ? current : new Set([...current, text]));
	}, [tooltipPos.visible, tooltipPos.text]);

	useEffect(() => {
		if (discoveredHints.size !== tooltipTotal || celebratedHints.current) return;
		celebratedHints.current = true;
		const theme = getComputedStyle(document.documentElement);
		void confetti({
			particleCount: 80, spread: 70, origin: { y: 0.6 },
			colors: ['--primary', '--chart-3', '--chart-5', '--chart-2', '--border'].map(color => theme.getPropertyValue(color).trim()),
			shapes: ['square'], scalar: 1.2, zIndex: 100, disableForReducedMotion: true,
		});
	}, [discoveredHints.size]);

	function hoverHint(text: string) {
		const show = (event: MouseEvent<Element>) => setTooltipPos({ x: Math.max(12, Math.min(event.clientX + 12, document.documentElement.clientWidth - 252)), y: Math.max(12, Math.min(event.clientY + 12, window.innerHeight - 100)), visible: true, text });
		const hide = () => setTooltipPos(current => ({ ...current, visible: false, text: undefined }));
		return {
			onMouseEnter: show, onMouseMove: show, onMouseLeave: hide,
			onFocus: (event: FocusEvent<Element>) => {
				const rect = event.currentTarget.getBoundingClientRect();
				setTooltipPos({ x: Math.max(12, Math.min(rect.left, document.documentElement.clientWidth - 252)), y: Math.max(12, Math.min(rect.bottom + 12, window.innerHeight - 100)), visible: true, text });
			},
			onBlur: hide,
			onKeyDown: (event: KeyboardEvent<Element>) => { if (event.key === 'Escape') hide(); },
		};
	}

	function saveDraft(pending: boolean) {
		try { sessionStorage.setItem(draftKey, JSON.stringify({ url, authorized, active, formSubmissionTesting, pending })); } catch {}
	}

	async function startScan(draft: Draft, confirmed = false) {
		if (busy) return;
		if (!confirmed) {
			try {
				const siteKey = (value: string) => new URL(value).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
				if (scans.some(scan => ['queued', 'running'].includes(scan.status) && siteKey(scan.url) === siteKey(draft.url))) {
					setScanSetupOpen(false);
					setDuplicateDraft(draft);
					return;
				}
			} catch {}
		}
		setBusy(true);
		setError('');
		try {
			const response = await fetch('/api/scans', {
				method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-TOKEN': page.csrfToken },
				body: JSON.stringify({ url: draft.url, authorizedToScan: draft.authorized, activeSecurityChecksAuthorized: draft.active, formSubmissionTestingAuthorized: draft.formSubmissionTesting, duplicateScanConfirmed: confirmed }),
			});
			const result = await response.json();
			if (response.status === 409 && result.code === 'scan_already_running') {
				setScanSetupOpen(false);
				setDuplicateDraft(draft);
				return;
			}
			if (response.status === 401 || response.status === 419) {
				setExpired(true);
				throw new Error('Je sessie is verlopen. Log opnieuw in met SOL 3.0.');
			}
			if (!response.ok) throw new Error(result.errors ? String(Object.values(result.errors).flat()[0]) : result.message ?? 'De scan kon niet worden gestart.');
			setScans(current => [result as Scan, ...current].slice(0, 10));
			setScanSetupOpen(false);
			setUrl('');
			setScanToReveal(result.id);
			try { sessionStorage.removeItem(draftKey); } catch {}
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Geen verbinding. Probeer opnieuw.');
		} finally { setBusy(false); }
	}

	useEffect(() => {
		if (!scanToReveal) return;
		historyTitle.current?.focus({ preventScroll: true });
		historyTitle.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
	}, [scanToReveal]);

	useEffect(() => {
		if (page.user && initialDraft.pending && !page.authError) {
			try { sessionStorage.setItem(draftKey, JSON.stringify({ ...initialDraft, pending: false })); } catch {}
			setScanSetupOpen(true);
		}
	}, []);

	const pendingIds = scans.filter(scan => ['queued', 'running'].includes(scan.status)).map(scan => scan.id).join(',');
	useEffect(() => {
		if (!pendingIds || expired) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const controller = new AbortController();
		async function poll() {
			try {
				const results = await Promise.all(pendingIds.split(',').map(async id => {
					const response = await fetch(`/api/scans/${id}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
					if (response.status === 401) { if (!cancelled) setExpired(true); throw new Error('Session expired'); }
					if (!response.ok) throw new Error('Polling unavailable');
					return await response.json() as Scan;
				}));
				const statsResponse = await fetch('/api/stats', { signal: controller.signal }).catch(() => null);
				const stats = statsResponse?.ok ? await statsResponse.json() : null;
				if (!cancelled) {
					setScans(current => current.map(scan => results.find(result => result.id === scan.id) ?? scan));
					setPollingError(false);
					if (stats) setUniqueSites(stats.uniqueSites);
				}
			} catch { if (!cancelled) setPollingError(true); }
			if (!cancelled) timer = setTimeout(poll, 3000);
		}
		timer = setTimeout(poll, 1500);
		return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
	}, [pendingIds, expired]);

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const input = event.currentTarget.elements.namedItem('url') as HTMLInputElement;
		const trimmedUrl = url.trim();
		const normalizedUrl = /^[a-z][a-z\d+.-]*:/i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
		try {
			const parsedUrl = new URL(normalizedUrl);
			if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported protocol');
		} catch {
			input.setCustomValidity('Vul een geldig websiteadres in, zoals scouting.nl of https://scouting.nl.');
			input.reportValidity();
			return;
		}
		setUrl(normalizedUrl);
		setError('');
		setScanToReveal(null);
		setScanSetupOpen(true);
	}

	function confirmScan(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!signedIn) return;
		if (!authorized) { setError('Bevestig dat je deze website mag scannen.'); return; }
		void startScan({ url, authorized, active, formSubmissionTesting, pending: false });
	}

	return <>
		<a className="skip-link" href="#scan">Naar de websitecheck</a>
		<header className="site-header">
			<div className="container header-inner">
				<a href="#" className="brand" aria-label="Scouting Website Quickscan, bovenaan">
					<img src="/scouting-logo.png" alt="Scouting" width="54" height="48" />
					<span>WEBSITE<span className="brand-sub">QUICKSCAN</span></span>
				</a>
				<nav aria-label="Hoofdnavigatie"><a href="#checks">De checks</a><a href="#faq">Veelgestelde vragen</a></nav>
				{signedIn ? <form action="/logout" method="post" onSubmit={() => { try { sessionStorage.removeItem(draftKey); } catch { } }}>
					<input type="hidden" name="_token" value={page.csrfToken} />
					<Button variant="outline" type="submit" size="sm"><LogOut aria-hidden="true" />Uitloggen</Button>
				</form> : <Button variant="outline" size="sm" asChild><a href="/auth/sol" onClick={() => saveDraft(false)}><LockKeyhole aria-hidden="true" />Log in met SOL 3.0</a></Button>}
			</div>
		</header>
		<main>
			<section id="scan" className="hero" aria-labelledby="hero-title">
				<div className="container hero-content">
					{error && <Alert id="scan-error" className="feedback" role="alert"><AlertTitle>Even opletten</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
					<div className="eyebrow"><span className="eyebrow-line" />TIPS VOOR EEN BETERE WEBSITE. VOOR SCOUTS DOOR SCOUTS</div>
					<h1 id="hero-title">Website <span>Quickscan.</span></h1>
					<p className="hero-intro">Een frisse blik op je website.<br />Een kompas voor wat goed gaat en wat beter kan.</p>
					<form className="scan-form" onSubmit={submit}>
						<Label htmlFor="website" className="url-label">Welke website wil je checken?</Label>
						<div className="url-row">
							<div className="url-input"><Globe2 aria-hidden="true" {...hoverHint('Een hele wereld aan websites. We beginnen met die van jou.')} /><Input id="website" name="url" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="https://jouwscoutinggroep.nl" maxLength={2048} required value={url} onChange={event => { event.target.setCustomValidity(''); setUrl(event.target.value); setAuthorized(false); setActive(false); setFormSubmissionTesting(false); }} aria-describedby={error ? 'scan-error' : undefined} autoComplete="url" /></div>
							<Button id="scan-start" className="scan-action" type="submit" size="lg" disabled={busy}>Scannen<ArrowRight aria-hidden="true" /></Button>
						</div>
						<div className="form-meta"><span><Check aria-hidden="true" />Binnen enkele minuten inzicht</span><span><Check aria-hidden="true" />Geen technische kennis nodig</span><span><Check aria-hidden="true" />Alleen met jouw toestemming</span></div>
					</form>
					{signedIn && <>
						<p className="welcome">Aangemeld als {page.user?.name}.</p>
						{page.scanLimits && <div className="scan-limits-info" style={{ marginTop: '1rem', padding: '0.75rem 1rem', backgroundColor: '#f5f5f5', borderRadius: '0.5rem', fontSize: '0.875rem', textAlign: 'center' }}>
							{page.scanLimits.isAdmin ? <>Admin · onbeperkt scannen. Vandaag <strong>{page.scanLimits.userScansToday}</strong> scans gestart.</> : <>Je hebt vandaag <strong>{page.scanLimits.userScansToday}</strong> van je <strong>{page.scanLimits.userScansLimit}</strong> scans gebruikt.</>}
							{!page.scanLimits.isAdmin && page.scanLimits.userScansToday >= 8 && <div style={{ marginTop: '0.5rem', color: '#d97706' }}>Je bent dicht bij je dagelijkse limiet.</div>}
						</div>}
					</>}
					<a href="#checks" className="discover" {...hoverHint('We kijken verder dan ‘hij doet het op mijn laptop’.')}>Wat bekijken we precies?<ArrowDown size={18} aria-hidden="true" /></a>
				</div>
			</section>
			<section className="counter-band" aria-label="Aantal gecontroleerde websites">
				<div className="container counter-inner"><div className="counter-number" aria-live="polite" {...hoverHint('Al deze websites gingen je voor. Groepsdruk, maar dan nuttig.')}>{new Intl.NumberFormat('nl-NL').format(uniqueSites)}<ArrowUpRight aria-hidden="true" /></div><div><h2>Scoutingwebsites gecheckt.</h2><p>Samen maken we Scouting online sterker.</p></div><Globe2 className="counter-globe" aria-hidden="true" {...hoverHint('De wereld draait door. Je website hopelijk ook.')} /></div>
			</section>
			{signedIn && scans.length > 0 && <section className="scan-history container" aria-labelledby="history-title">
				<div className="section-top"><h2 id="history-title" ref={historyTitle} tabIndex={-1}>Jouw scans</h2><Badge variant="outline">Alleen zichtbaar voor jou</Badge></div>
				{pollingError && <p role="status">Status ophalen lukt even niet. We proberen het opnieuw; je scan gaat op de achtergrond verder.</p>}
				<div aria-live="polite" className="scan-list">{scans.map(scan => <div key={scan.id} className="scan-item">
					<div className="scan-details"><span className="scan-url">{scan.url}</span><span className="scan-phase">{['queued', 'running'].includes(scan.status) && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}{phaseNames[scan.phase] ?? 'Scan bezig'}{scan.error ? `: ${scan.error}` : ''}</span></div>
					{scan.status === 'completed' ? <div className="report-links"><Button variant="outline" size="sm" asChild><a href={`/api/scans/${scan.id}/report.html`} target="_blank" rel="noopener noreferrer"><FileText aria-hidden="true" />Rapport</a></Button></div> : <Badge variant="outline">{scan.status === 'failed' ? 'Niet afgerond' : 'In behandeling'}</Badge>}
				</div>)}</div>
			</section>}
			<section id="checks" className="checks-section" aria-labelledby="checks-title">
				<div className="container">
					<div className="section-heading"><div><p className="eyebrow">NIET ALLEEN EEN MOOI PLAATJE</p><h2 id="checks-title">Vier onderzoeken.<br />Een rapport.</h2></div><p>Een goede website werkt, is vindbaar en nodigt uit om mee te doen. We kijken naar techniek en de ervaring van je bezoekers.</p></div>
					<div className="checks-grid">{checks.map(check => <Card key={check.number} className={`check-card ${check.color}`} {...hoverHint(checkHints[check.number])}>
						<CardHeader><div className="check-top"><check.icon size={30} strokeWidth={1.8} aria-hidden="true" /><span>{check.number}</span></div><h3>{check.title}</h3></CardHeader>
						<CardContent><p className="method">{check.method}</p><p>{check.text}</p><div className="check-tags">{check.tags.map(tag => <Badge key={tag} variant="outline">{tag}</Badge>)}</div></CardContent>
					</Card>)}</div>
					<div className="method-note"><p>Dit systeem is een quickscan. Het vervangt geen audit, pen-test of specialist. Het helpt je wel om de eerste stappen te zetten naar een betere website. Vaak kan je met een paar kleine veranderingen al een wereld van verschil maken.</p></div>
				</div>
			</section>
			<section className="steps-band" aria-labelledby="steps-title"><div className="container"><h2 id="steps-title">Van website naar volgende stap.</h2><ol className="steps"><li><span>1</span><div><h3>Vul je website in</h3><p>Bevestig dat je de website mag scannen.</p></div></li><li><span>2</span><div><h3>Meld je aan via SOL</h3><p>Deze tool is alleen voor scouts.</p></div></li><li><span>3</span><div><h3>Maak het verschil</h3><p>Ga aan de slag met de punten of deel je verbeterpunten met je webbeheerder.</p></div></li></ol></div></section>
			<section className="methodology-band" aria-labelledby="methodology-title"><div className="container"><div className="section-heading"><div><p className='eyebrow'>NIET UIT DE LUCHT GEGREPEN</p><h2 id="methodology-title">Hoe de adviezen tot stand zijn gekomen.</h2></div><p>De Quickscan is gemaakt samen met communicatie-experts en tips van de belangrijkste bedrijven. Zo wordt jouw website extra goed beoordeeld.</p></div><div className="methodology-content"><div className="methodology-item"><h3>Technische adviezen</h3><p>De technische controles zijn gebaseerd op best-practices van <strong>Google</strong> en <strong>Mozilla</strong>. Zij stellen wereldwijd standaarden op voor veiligheid, snelheid en toegankelijkheid. Jouw website wordt langs hun lat gelegd.</p></div><div className="methodology-item"><h3>Communicatieadviezen</h3><p>Voor de beoordeling van inhoud en gebruikerservaring heb ik gesproken met <strong>vrijwilligers en beroepskrachten</strong> van Scouting Nederland. Zij delen wat een goed werkende Scoutingwebsite nodig heeft: helder communiceren over wie je bent, wat je aanbiedt, en hoe anderen kunnen meedoen.</p></div><div className="methodology-item"><h3>Onderzoek</h3><p>Deze tips zijn ontwikkeld voor de <strong>Communicatiedag van Scouting Nederland</strong> op 8 november 2026 op het LSC. Na de feedback en inzichten van die dag heb ik een prototype van deze tool ontwikkeld en is die nu voor jou beschikbaar.</p></div></div></div></section>
			<section className="about-band" aria-labelledby="about-title"><div className="container"><div className="about-content"><div className="about-text"><h2 id="about-title">Van de maker</h2><p>Ik ben al sinds jongs af aan bezig met programmeren. Zoals bij veel ontwikkelaars is dat ooit begonnen met websites. Sinds 2020 ben ik als vrijwilliger voor Scouting Nederland actief en ontwikkel ik websites en webapplicaties. De kans is groot dat jij, als Scout, een van die websites wel eens hebt gebruikt.<br /><br /> Voor de landelijke communicatiedag in november 2026 is mij gevraagd of ik een presentatie wilde geven over websites. Waar vaak de techniek wordt uitgelicht, heb ik voor iets anders gekozen. Ik heb een ronde gebeld en veel mensen met een communicatie achtergrond gevraagd om hun beste tip, mooiste website en adviezen te delen. Daar heb ik een presentatie van gemaakt met 10 tips voor een betere website, die je eigenlijk gelijk kan uitvoeren. Om de deelnemers van de workshop gelijk iets mee te geven heb ik deze tool ontwikkeld. Met AI controleert de tool de website op de 10 tips uit de presentatie. Daarnaast heb ik allerlei technische checks toegevoegd, omdat dat uiteindelijk mijn eigen kracht is. De tool die daar uitkwam, is nu beschikbaar voor alle scouts in Nederland. <br /><br />Veel succes met jouw website. <br /> <b>-Timo Klabbers</b></p><Button variant="outline" size="xs" asChild><a href="http://linkedin.com/in/timo-klabbers" target="_blank" rel="noopener noreferrer"><Linkedin aria-hidden="true" size={14} />LinkedIn</a></Button></div><div className="about-graphic"><div className="profile-wrapper" onMouseEnter={() => setTooltipPos({...tooltipPos, visible: true})} onMouseLeave={() => setTooltipPos({...tooltipPos, visible: false})} onMouseMove={(e) => setTooltipPos({x: e.clientX + 12, y: e.clientY + 12, visible: true})}><img src="profile-bw-min.webp" alt="Timo Klabbers" className="profile-image" width="280" height="280" /></div></div></div></div></section>
			<div className="faq-top-sites container">
				<section id="faq" className="faq-section" aria-labelledby="faq-title"><div className="section-heading"><div><p className="eyebrow">GOED OM TE WETEN</p><h2 id="faq-title">Nog een vraag?</h2></div><p>Over de scan, je gegevens en wat je van het rapport kunt verwachten.</p></div><Accordion type="single" collapsible className="faq-list">{faqs.map(([question, answer], index) => <AccordionItem value={`faq-${index}`} key={question}><AccordionTrigger>{question}</AccordionTrigger><AccordionContent>{answer}</AccordionContent></AccordionItem>)}</Accordion></section>
				<section id="top-sites" className="top-sites-section" aria-labelledby="top-sites-title">
					<div className="section-heading"><div><p className="eyebrow">INSPIRATIE VAN ANDERE SCOUTS</p><h2 id="top-sites-title">Tien beste Scoutingwebsites</h2></div><p>Heb jij een site die heel mooi is en goed scoort op de test? Als jij je score deelt dan komen de tien websites met de hoogste score in de ranglijst te staan.</p></div>
					{page.topSites.length ? <ol className="top-sites-list">{page.topSites.map((site, index) => <li key={site.url}><a href={site.url} target="_blank" rel="noopener noreferrer"><span className="top-site-rank" aria-label={`Plaats ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span><span className="top-site-name"><strong>{site.title}</strong><span>{new URL(site.url).hostname}</span></span><span className="top-site-score">{site.score}%</span><ArrowUpRight size={18} aria-hidden="true" /></a></li>)}</ol> : <p className="top-sites-empty">Er zijn nog geen scores gedeeld.</p>}
				</section>
			</div>
			<section className="closing-band"><div className="container"><h2>Klaar voor een frisse blik?</h2><Button variant="secondary" size="lg" asChild><a href="#scan" {...hoverHint('Kom! Streep dat puntje van je actielijst!')}>Check je website<ArrowRight aria-hidden="true" /></a></Button></div></section>
		</main>
		<Dialog open={scanSetupOpen} onOpenChange={open => { if (!busy) setScanSetupOpen(open); }}>
			<DialogContent className="scan-dialog" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); if (scanToReveal) historyTitle.current?.focus({ preventScroll: true }); else document.getElementById('scan-start')?.focus({ preventScroll: true }); }}>
				<DialogHeader>
					<DialogTitle>{signedIn ? 'Quickscan starten' : 'Bijna klaar om te scannen'}</DialogTitle>
					<DialogDescription>{signedIn ? 'Bevestig je toestemming en kies eventuele extra controles.' : 'Om het rapport veilig op te slaan voor jouw groep, log je in met je Scouting-account.'}</DialogDescription>
				</DialogHeader>
				<p className="scan-target"><Globe2 size={18} aria-hidden="true" /><span>{url}</span></p>
				{error && <Alert role="alert"><AlertTitle>Even opletten</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
				{signedIn ? <form onSubmit={confirmScan}>
					<fieldset className="scan-consents" disabled={busy}>
						<legend className="sr-only">Toestemming en extra controles</legend>
						<div className="consent-row"><Checkbox id="authorized" checked={authorized} onCheckedChange={value => setAuthorized(value === true)} required disabled={busy} /><Label htmlFor="authorized">Ik bevestig dat ik betrokken ben bij deze Scoutinggroep en toestemming heb om deze scan uit te voeren.</Label></div>
						<details className="scan-advanced">
							<summary>Geavanceerde controles <span>(optioneel)</span></summary>
							<div className="consent-row"><Checkbox id="active" checked={active} onCheckedChange={value => setActive(value === true)} disabled={busy} /><Label htmlFor="active">Controleer openbare configuratie- en back-upbestanden</Label></div>
							<div className="consent-row"><Checkbox id="formSubmissionTesting" checked={formSubmissionTesting} onCheckedChange={value => setFormSubmissionTesting(value === true)} disabled={busy} /><Label htmlFor="formSubmissionTesting">Test contactformulieren met AI-testdata (zonder verzending)</Label></div>
						</details>
					</fieldset>
					<div className="scan-dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setScanSetupOpen(false)}>Annuleren</Button><Button className="scan-action" type="submit" disabled={busy || !authorized}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{busy ? 'Scan starten...' : 'Start volledige scan'}</Button></div>
				</form> : <div className="scan-login-actions">
					<Button className="scan-action" asChild><a href="/auth/sol" onClick={() => saveDraft(true)}><LockKeyhole aria-hidden="true" />Inloggen met Scouting Online (SOL)</a></Button>
					<Button type="button" variant="ghost" onClick={() => setScanSetupOpen(false)}>Annuleren</Button>
				</div>}
			</DialogContent>
		</Dialog>
		<AlertDialog open={duplicateDraft !== null} onOpenChange={open => { if (!open) setDuplicateDraft(null); }}>
			<AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md" onCloseAutoFocus={event => { event.preventDefault(); document.getElementById('website')?.focus({ preventScroll: true }); }}>
				<AlertDialogHeader>
					<AlertDialogTitle>Er loopt al een scan</AlertDialogTitle>
					<AlertDialogDescription>Er loopt nog een scan voor deze website. Wil je toch nog een scan starten?</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Annuleren</AlertDialogCancel>
					<AlertDialogAction onClick={() => { if (duplicateDraft) void startScan(duplicateDraft, true); }}>Toch een scan starten</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
		<footer className="site-footer"><div className="container footer-inner"><div className="footer-brand"><img src="/scouting-logo.png" width="64" height="58" alt="Scouting" /><div><strong>Website Quickscan</strong><p>Tips voor een betere website. Voor en door scouts.</p></div></div><div className="footer-links"><a href="https://www.scouting.nl/privacy" target="_blank" rel="noopener noreferrer">Privacy<ArrowUpRight size={14} aria-hidden="true" /></a><a href="#faq">Veelgestelde vragen</a><span>{new Date().getFullYear()} · Timo Klabbers</span></div></div></footer>
		{tooltipPos.visible && <div className="tooltip" aria-hidden="true" style={{left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px`}}>{tooltipPos.text ?? makerHint}</div>}
		{discoveredHints.size > 0 && <aside className="hint-progress" aria-label="Ontdekte hoverhints"><span role="status">{discoveredHints.size} / {tooltipTotal}</span><div className="hint-progress-track" role="progressbar" aria-label="Ontdekte hoverhints" aria-valuemin={0} aria-valuemax={tooltipTotal} aria-valuenow={discoveredHints.size}><span style={{ width: `${discoveredHints.size / tooltipTotal * 100}%` }} /></div></aside>}
	</>;
}

createRoot(document.getElementById('app')!).render(page.report ? <ReportPage report={page.report} csrfToken={page.csrfToken} /> : <App />);