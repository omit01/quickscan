import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, CircleAlert, CircleHelp, ShieldCheck, Sparkles, Printer, Share2, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { prioritizeActions } from './report-priorities';

type CheckResult = { status: 'pass' | 'warning' | 'fail' | 'unavailable'; score: number; detail: string };
type Criterion = { score: number; toelichting: string; verbeterpunt: string; insufficientEvidence?: boolean };
export type Report = {
	id: string; url: string;
	score: number | null; shared: boolean;
	results: { home: { title: string | null; url: string }; technical: Record<string, CheckResult>; ai?: { criteria: Record<string, Criterion> } | null; aiError?: string | null; generatedAt: string };
};

const guides: Record<string, { label: string; meaning: string; action: string; url: string }> = {
	https: { label: 'Beveiligde verbinding', meaning: 'HTTPS versleutelt het verkeer tussen bezoeker en website.', action: 'Vraag de beheerder om HTTPS en een automatische doorverwijzing in te stellen.', url: 'https://web.dev/articles/why-https-matters' },
	mobile: { label: 'Mobiele bediening', meaning: 'Controleert of de homepage bruikbaar is op een klein touchscreen.', action: 'Maak knoppen groter en verwijder horizontaal scrollen.', url: 'https://web.dev/articles/accessible-tap-targets' },
	pagespeed: { label: 'Laadsnelheid', meaning: 'Meet hoe snel de homepage op mobiel bruikbaar wordt.', action: 'Verklein grote afbeeldingen en vraag de beheerder naar caching.', url: 'https://web.dev/articles/optimize-lcp' },
	cls: { label: 'Visuele stabiliteit (CLS)', meaning: 'Cumulative Layout Shift meet onverwachte bewegingen van elementen tijdens het laden.', action: 'Vermijd afbeeldingen en iframes zonder vastgestelde grootte; laad advertenties asynchron.', url: 'https://web.dev/articles/cls' },
	ssl_chain: { label: 'SSL-certificaatvalidatie', meaning: 'Controleert of het SSL-certificaat geldig en niet zelfondertekend is.', action: 'Vraag een geldig SSL-certificaat aan bij een erkende certificaatautoriteit.', url: 'https://www.ssl.com/article/ssl-certificate-chain-explained' },
	dns_safety: { label: 'DNS en mail-routing', meaning: 'Controleert of DNS correct is ingesteld voor e-maillevering.', action: 'Configureer MX-records correct in DNS-instellingen.', url: 'https://www.icann.org/en/dns' },
	form_submission: { label: 'Formuliertest', meaning: 'Test of contactformulieren kunnen worden ingediend.', action: 'Test formulieren handmatig en controleer of berichten aankomen.', url: 'https://www.w3.org/WAI/tutorials/forms/' },
	links_media: { label: 'Links en afbeeldingen', meaning: "Zoekt kapotte interne links en afbeeldingen op de bezochte pagina's.", action: 'Herstel of verwijder de genoemde verouderde verwijzingen.', url: 'https://web.dev/learn/html/links' },
	accessibility: { label: 'Toegankelijkheid', meaning: 'Controleert basisinformatie voor bezoekers die hulptechnologie gebruiken.', action: 'Vul alt-teksten, formuliervelden en de paginataal aan.', url: 'https://web.dev/learn/accessibility' },
	seo_basics: { label: 'Zoekmachinebasis', meaning: 'Controleert informatie waarmee zoekmachines en bezoekers de pagina begrijpen.', action: 'Schrijf een duidelijke titel, metabeschrijving en hoofdkop.', url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide' },
	indexability: { label: 'Vindbaarheid', meaning: 'Controleert of zoekmachines de website kunnen vinden en mogen opnemen.', action: 'Controleer robots.txt, sitemap.xml en onbedoelde noindex-instellingen.', url: 'https://developers.google.com/search/docs/crawling-indexing/overview' },
	structured_data: { label: 'Gestructureerde gegevens', meaning: 'Extra gegevens waarmee zoekmachines de organisatie en inhoud beter begrijpen.', action: 'Voeg Organization-gegevens toe met schema.org-markup.', url: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data' },
	social_metadata: { label: 'Delen op sociale media', meaning: 'Bepaalt titel, tekst en afbeelding wanneer een pagina wordt gedeeld.', action: 'Voeg Open Graph- en X Card-tags toe aan de homepage.', url: 'https://ogp.me/' },
	security_headers: { label: 'Beveiligingsheaders', meaning: 'Browserinstellingen die veelvoorkomende aanvallen helpen beperken.', action: 'Vraag de hosting- of webbeheerder om de ontbrekende headers toe te voegen.', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers' },
	cms_version: { label: 'CMS en software', meaning: 'Kijkt of software-informatie onnodig openbaar staat.', action: 'Werk het CMS bij en verberg versies waar mogelijk.', url: 'https://www.ncsc.nl/onderwerpen/webapplicaties' },
	exposure: { label: 'Openbare configuratiebestanden', meaning: 'Controleert bekende locaties voor publiek toegankelijke configuratie- of back-upbestanden, uitsluitend met extra toestemming.', action: 'Verwijder het bestand uit de webmap en ververs eventuele sleutels.', url: 'https://owasp.org/www-project-top-ten/' },
};
const criterionLabels: Record<string, string> = {
	beeldgebruik: 'Beeldgebruik', call_to_action: 'Uitnodigen om mee te doen', actualiteit: 'Actualiteit', informatiearchitectuur: 'Navigatie en structuur',
	vrijwilligerswerving: 'Vrijwilligers werven', taalgebruik: 'Taalgebruik', contact_avg: 'Contact en privacy', mobiele_ervaring: 'Mobiele ervaring',
	brand_consistency: 'Professionele uitstraling',
};
const statuses = {
	pass: { label: 'Goed', icon: Check }, warning: { label: 'Aandachtspunt', icon: CircleAlert },
	fail: { label: 'Aanpakken', icon: CircleAlert }, unavailable: { label: 'Niet beoordeeld', icon: CircleHelp },
};
const severity = { fail: 0, warning: 1, unavailable: 2, pass: 3 };

function Status({ result }: { result: CheckResult }) {
	const state = statuses[result.status];
	return <Badge variant="outline" className={`result-status status-${result.status}`}><state.icon size={14} aria-hidden="true" />{state.label}</Badge>;
}

export function ReportPage({ report, csrfToken }: { report: Report; csrfToken: string }) {
	const [shared, setShared] = useState(report.shared);
	const [sharing, setSharing] = useState(false);
	const [shareError, setShareError] = useState('');
	const { results } = report;
	const technical = Object.entries(results.technical).sort(([, first], [, second]) => severity[first.status] - severity[second.status] || first.score - second.score);
	const criteria = Object.entries(results.ai?.criteria ?? {});
	const assessed = technical.filter(([, result]) => result.status !== 'unavailable');
	const passed = assessed.filter(([, result]) => result.status === 'pass').length;
	const evidence = criteria.filter(([, result]) => !result.insufficientEvidence);
	const experience = evidence.length ? (evidence.reduce((total, [, result]) => total + result.score, 0) / evidence.length).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) : null;
	const actions = prioritizeActions(results).map(({ key, source }) => ({
		key, source,
		label: source === 'Techniek' ? guides[key]?.label ?? key : criterionLabels[key] ?? key,
		action: source === 'Techniek' ? guides[key]?.action ?? results.technical[key].detail : results.ai!.criteria[key].verbeterpunt,
	}));

	async function shareScore() {
		if (!window.confirm('Wil je de sitenaam, websitelink en score openbaar delen voor de top 10? Je rapport en accountgegevens worden niet openbaar. Een eerder gedeelde score van deze website wordt vervangen.')) return;
		setSharing(true);
		setShareError('');
		try {
			const response = await fetch(`/api/scans/${report.id}/share`, {
				method: 'POST', headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrfToken },
			});
			if (response.status === 401 || response.status === 419) throw new Error('Je sessie is verlopen. Log opnieuw in via de homepage.');
			const result = await response.json();
			if (!response.ok) throw new Error(result.errors ? String(Object.values(result.errors).flat()[0]) : 'Delen is niet gelukt. Probeer opnieuw.');
			setShared(true);
		} catch (failure) {
			setShareError(failure instanceof Error ? failure.message : 'Geen verbinding. Probeer opnieuw.');
		} finally { setSharing(false); }
	}

	return <>
		<a className="skip-link" href="#report-results">Naar de resultaten</a>
		<header className="site-header"><div className="container header-inner">
			<a href="/" className="brand"><img src="/scouting-logo.png" alt="Scouting" width="54" height="48" /><span>WEBSITE<span className="brand-sub">QUICKSCAN</span></span></a>
			<Button variant="outline" size="sm" asChild><a href="/#history-title"><ArrowLeft aria-hidden="true" />Jouw scans</a></Button>
		</div></header>
		<main className="report-page">
			<section className="report-heading"><div className="container">
				<div className="report-meta"><Badge variant="outline">Jouw rapport</Badge><time dateTime={results.generatedAt}>{new Date(results.generatedAt).toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short' })}</time></div>
				<h1>{results.home.title || new URL(report.url).hostname}</h1>
				<a className="report-site" href={report.url} target="_blank" rel="noopener noreferrer">{report.url}<ArrowUpRight size={18} aria-hidden="true" /></a>
				<div className="report-overall">
					<div><h2>Gewogen score</h2><strong>{report.score === null ? '-' : `${report.score}%`}</strong><p>{report.score === null ? 'Nog geen totaalscore: techniek en bezoekerservaring moeten allebei beoordeeld zijn.' : '50% techniek en 50% bezoekerservaring. Niet-beoordeelde onderdelen tellen niet mee.'}</p></div>
					{report.score !== null && <div className="report-share">
						<Button onClick={() => void shareScore()} disabled={sharing || shared}>{sharing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : shared ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}{sharing ? 'Score delen...' : shared ? 'Score gedeeld' : 'Deel deze score'}</Button>
						{shared ? <p role="status">Je score is gedeeld. <a href="/#top-sites">Bekijk de top 10<ArrowUpRight size={14} aria-hidden="true" /></a></p> : <p>Alleen je sitenaam, link en score worden openbaar.</p>}
						{shareError && <p role="alert">{shareError}</p>}
					</div>}
				</div>
				<div className="report-summary">
					<Card className="summary-good"><CardHeader><h2>Techniek op orde</h2></CardHeader><CardContent><strong>{passed}<span> / {assessed.length}</span></strong><p>{technical.length - assessed.length} niet beoordeeld</p></CardContent></Card>
					<Card className="summary-attention"><CardHeader><h2>Aandachtspunten</h2></CardHeader><CardContent><strong>{assessed.length - passed}</strong><p>Technische verbeterpunten</p></CardContent></Card>
					<Card className="summary-experience"><CardHeader><h2>Bezoekerservaring</h2></CardHeader><CardContent><strong>{experience ?? '-'}<span>{experience ? ' / 5' : ''}</span></strong><p>{evidence.length ? `${evidence.length} criteria met voldoende bewijs` : 'Niet beoordeeld'}</p></CardContent></Card>
				</div>
			</div></section>
			<section className="report-actions"><div className="container"><p className="eyebrow">VAN INZICHT NAAR ACTIE</p><h2>Begin hiermee.</h2>
				{actions.length ? <ol>{actions.map((action, index) => <li key={action.key}><span className="action-number">0{index + 1}</span><div><Badge variant="outline">{action.source}</Badge><h3>{action.label}</h3><p>{action.action}</p></div></li>)}</ol> : <p>Geen verbeterpunten gevonden in de beoordeelde onderdelen. Bekijk ook de niet-beoordeelde checks.</p>}
			</div></section>
			<section id="report-results" className="container report-results"><h2>Alle resultaten.</h2>
				<Tabs defaultValue="experience"><TabsList aria-label="Rapportonderdelen"><TabsTrigger value="experience"><Sparkles aria-hidden="true" />Bezoekerservaring ({criteria.length})</TabsTrigger><TabsTrigger value="technical"><ShieldCheck aria-hidden="true" />Techniek ({technical.length})</TabsTrigger></TabsList>
					<TabsContent value="technical" data-print-section="TECHNIEK"><p className="report-section-note">Automatische controles op de bezochte pagina's. Niet-beoordeelde checks tellen niet als geslaagd.</p>
						{technical.length ? <Accordion type="multiple" className="report-checks">{technical.map(([key, result]) => <AccordionItem key={key} value={key}>
							<AccordionTrigger><span className="result-name">{guides[key]?.label ?? key}</span><Status result={result} /></AccordionTrigger>
							<AccordionContent><div className="result-detail"><p className="result-observation">{result.detail}</p>{result.status !== 'unavailable' && <p className="result-score">Testscore: {result.score}/100</p>}
								{guides[key] && <><h3>Wat betekent dit?</h3><p>{guides[key].meaning}</p>{(result.status === 'warning' || result.status === 'fail') && <><h3>Volgende stap</h3><p>{guides[key].action}</p></>}
								<a href={guides[key].url} target="_blank" rel="noopener noreferrer">Meer informatie<ArrowUpRight size={14} aria-hidden="true" /></a></>}
							</div></AccordionContent>
						</AccordionItem>)}</Accordion> : <Alert><AlertTitle>Geen technische resultaten</AlertTitle><AlertDescription>Voor deze scan zijn geen technische controles beschikbaar.</AlertDescription></Alert>}
					</TabsContent>
					<TabsContent value="experience" data-print-section="BEZOEKERSERVARING"><p className="report-section-note">AI-beoordeling op basis van zichtbare tekst en screenshots. Controleer de adviezen zelf; AI kan zich vergissen.</p>
						{criteria.length ? <Accordion type="multiple" className="report-checks">{criteria.map(([key, result]) => <AccordionItem key={key} value={key}>
							<AccordionTrigger><span className="result-name">{criterionLabels[key] ?? key}</span><Badge variant="outline" className={`result-status ${result.insufficientEvidence ? 'status-unavailable' : result.score >= 4 ? 'status-pass' : 'status-warning'}`}>{result.insufficientEvidence ? 'Onvoldoende bewijs' : `${result.score} / 5`}</Badge></AccordionTrigger>
							<AccordionContent><div className="result-detail"><h3>Beoordeling</h3><p>{result.toelichting}</p><h3>Verbeterpunt</h3><p>{result.verbeterpunt}</p></div></AccordionContent>
						</AccordionItem>)}</Accordion> : <Alert><CircleHelp aria-hidden="true" /><AlertTitle>Bezoekerservaring niet beoordeeld</AlertTitle><AlertDescription>{results.aiError || 'De AI-analyse was niet beschikbaar voor deze scan.'}</AlertDescription></Alert>}
					</TabsContent>
				</Tabs>
				
				{/* Print-only version with all results expanded */}
				<div className="print-only-results">
					<div className="print-section" data-print-section="TECHNIEK">
						<p className="report-section-note">Automatische controles op de bezochte pagina's. Niet-beoordeelde checks tellen niet als geslaagd.</p>
						{technical.length ? <div className="report-checks">{technical.map(([key, result]) => <div key={key} className="print-check-item">
							<div className="print-check-header"><span className="result-name">{guides[key]?.label ?? key}</span><Status result={result} /></div>
							<div className="result-detail"><p className="result-observation">{result.detail}</p>{result.status !== 'unavailable' && <p className="result-score">Testscore: {result.score}/100</p>}
								{guides[key] && <><h3>Wat betekent dit?</h3><p>{guides[key].meaning}</p>{(result.status === 'warning' || result.status === 'fail') && <><h3>Volgende stap</h3><p>{guides[key].action}</p></>}
								<a href={guides[key].url} target="_blank" rel="noopener noreferrer">Meer informatie<ArrowUpRight size={14} aria-hidden="true" /></a></>}
							</div>
						</div>)}</div> : <Alert><AlertTitle>Geen technische resultaten</AlertTitle><AlertDescription>Voor deze scan zijn geen technische controles beschikbaar.</AlertDescription></Alert>}
					</div>
					
					<div className="print-section" data-print-section="BEZOEKERSERVARING">
						<p className="report-section-note">AI-beoordeling op basis van zichtbare tekst en screenshots. Controleer de adviezen zelf; AI kan zich vergissen.</p>
						{criteria.length ? <div className="report-checks">{criteria.map(([key, result]) => <div key={key} className="print-check-item">
							<div className="print-check-header"><span className="result-name">{criterionLabels[key] ?? key}</span><Badge variant="outline" className={`result-status ${result.insufficientEvidence ? 'status-unavailable' : result.score >= 4 ? 'status-pass' : 'status-warning'}`}>{result.insufficientEvidence ? 'Onvoldoende bewijs' : `${result.score} / 5`}</Badge></div>
							<div className="result-detail"><h3>Beoordeling</h3><p>{result.toelichting}</p><h3>Verbeterpunt</h3><p>{result.verbeterpunt}</p></div>
						</div>)}</div> : <Alert><CircleHelp aria-hidden="true" /><AlertTitle>Bezoekerservaring niet beoordeeld</AlertTitle><AlertDescription>{results.aiError || 'De AI-analyse was niet beschikbaar voor deze scan.'}</AlertDescription></Alert>}
					</div>
				</div>
			</section>
			<section className="report-footnote"><div className="container"><ShieldCheck aria-hidden="true" /><p>Dit is een quickscan, geen volledige veiligheids- of toegankelijkheidsaudit. Het rapport is alleen toegankelijk vanuit jouw account.</p></div></section>
		</main>
		<Button onClick={() => window.print()} className="print-button"><Printer size={18} aria-hidden="true" />Afdrukken</Button>
	</>;
}