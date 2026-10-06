import type { Report } from './report';

const impactWeights: Record<string, number> = {
	exposure: 100,
	https: 95,
	ssl_chain: 90,
	call_to_action: 90,
	mobile: 85,
	mobiele_ervaring: 85,
	accessibility: 85,
	informatiearchitectuur: 85,
	form_submission: 85,
	pagespeed: 80,
	cls: 80,
	links_media: 80,
	contact_avg: 80,
	indexability: 75,
	vrijwilligerswerving: 75,
	security_headers: 70,
	dns_safety: 70,
	actualiteit: 65,
	taalgebruik: 65,
	brand_consistency: 60,
	seo_basics: 50,
	beeldgebruik: 50,
	cms_version: 40,
	social_metadata: 25,
	structured_data: 20,
};

export function technicalScoreOnFive(score: number, maximum = 100) {
	return Math.round(score / maximum * 50) / 10;
}

export function prioritizeActions(results: Pick<Report['results'], 'technical' | 'ai' | 'technicalScoreMax'>) {
	const candidates = [
		...Object.entries(results.technical)
			.filter(([, result]) => result.status === 'fail' || result.status === 'warning')
			.map(([key, result]) => ({ key, deficit: (result.status === 'fail' ? 1 : Math.max(0.01, 1 - result.score / (results.technicalScoreMax ?? 100))), source: 'Techniek' })),
		...Object.entries(results.ai?.criteria ?? {})
			.filter(([, result]) => !result.insufficientEvidence && result.score < 4)
			.map(([key, result]) => ({ key, deficit: (5 - result.score) / 4, source: 'AI-analyse' })),
	].map(candidate => {
		const impact = impactWeights[candidate.key] ?? 50;
		return { ...candidate, impact, priority: impact * candidate.deficit };
	}).filter(candidate => candidate.priority > 0)
		.sort((first, second) => second.priority - first.priority || second.impact - first.impact || first.key.localeCompare(second.key, 'en'));
	const topics = new Set<string>();
	return candidates.filter(candidate => {
		const topic = candidate.key === 'mobiele_ervaring' ? 'mobile' : candidate.key;
		if (topics.has(topic)) return false;
		topics.add(topic);
		return true;
	}).slice(0, 3);
}