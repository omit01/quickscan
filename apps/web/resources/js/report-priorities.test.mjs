import assert from 'node:assert/strict';
import test from 'node:test';
import { prioritizeActions } from './report-priorities.ts';

const check = (score, status = 'warning') => ({ status, score, detail: 'Testresultaat.' });
const criterion = (score, insufficientEvidence = false) => ({ score, insufficientEvidence, toelichting: 'Beoordeling.', verbeterpunt: 'Verbeteradvies.' });

test('the top three combine impact and severity across technical and AI results', () => {
	const results = {
		technical: { structured_data: check(0), social_metadata: check(0), cms_version: check(40), mobile: check(40), accessibility: check(40) },
		ai: { criteria: { call_to_action: criterion(1), informatiearchitectuur: criterion(2), beeldgebruik: criterion(3) } },
	};
	assert.deepEqual(prioritizeActions(results).map(action => action.key), ['call_to_action', 'informatiearchitectuur', 'accessibility']);
	assert.deepEqual(prioritizeActions({ ...results, technical: Object.fromEntries(Object.entries(results.technical).reverse()) }), prioritizeActions(results));
});

test('severe security risks outrank metadata and less severe usability issues', () => {
	const actions = prioritizeActions({
		technical: { structured_data: check(0), mobile: check(80), https: check(0, 'fail'), exposure: check(0, 'fail') },
		ai: { criteria: { call_to_action: criterion(1) } },
	});
	assert.deepEqual(actions.map(action => action.key), ['exposure', 'https', 'call_to_action']);
});

test('worse scores increase priority and missing evidence never becomes an action', () => {
	const results = { technical: { pagespeed: check(80), https: check(0, 'unavailable'), mobile: check(100, 'pass') }, ai: { criteria: { call_to_action: criterion(1, true), taalgebruik: criterion(4) } } };
	const mild = prioritizeActions(results);
	const severe = prioritizeActions({ ...results, technical: { ...results.technical, pagespeed: check(20) } });
	assert.deepEqual(mild.map(action => action.key), ['pagespeed']);
	assert.ok(severe[0].priority > mild[0].priority);
	assert.deepEqual(prioritizeActions({ technical: {} }), []);
});

test('overlapping mobile advice is represented by its highest-priority result only', () => {
	const actions = prioritizeActions({
		technical: { mobile: check(40), pagespeed: check(40), social_metadata: check(0) },
		ai: { criteria: { mobiele_ervaring: criterion(1), actualiteit: criterion(2) } },
	});
	assert.deepEqual(actions.map(action => action.key), ['mobiele_ervaring', 'actualiteit', 'pagespeed']);
});