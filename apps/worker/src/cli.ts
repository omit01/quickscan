import { scanJobSchema, type TechnicalResults } from '@quickscan/contracts';
import { captureHomepage } from './capture.js';
import { runTechnicalChecks } from './technical.js';
import { evaluateSite } from './ai.js';
import { generateReport } from './report.js';
import { ScanLogger } from './logger.js';

let input = '';
for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 16_384) throw new Error('Scan input exceeds limit.');
}

let scan;
try {
    scan = scanJobSchema.parse(JSON.parse(input));
} catch (error) {
    console.error(JSON.stringify({
        type: 'error_log',
        phase: 'initialization',
        errorCode: 'INVALID_INPUT',
        message: error instanceof Error ? error.message : 'Invalid scan input',
        stack: error instanceof Error ? error.stack : undefined,
    }));
    process.exit(1);
}

const artifactsPath = process.env.ARTIFACTS_PATH ?? './artifacts';
const scanLogger = new ScanLogger(scan.scanId, artifactsPath);

const phase = (value: string) => console.log(JSON.stringify({ phase: value }));

try {
    phase('capturing_homepage');
    try {
        await captureHomepage(scan.scanId, scan.url, artifactsPath);
    } catch (error) {
        scanLogger.log(
            'capturing_homepage',
            'CAPTURE_FAILED',
            `Homepage capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            { url: scan.url },
            error instanceof Error ? error : undefined
        );
        throw error;
    }

    phase('running_technical_checks');
    let technical: TechnicalResults;
    try {
        technical = await runTechnicalChecks(
            scan.scanId,
            scan.url,
            artifactsPath,
            scan.activeSecurityChecksAuthorized,
            scan.formSubmissionTestingAuthorized
        );
    } catch (error) {
        // Log the error but don't fail - mark checks as unavailable and continue
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        scanLogger.log(
            'running_technical_checks',
            'TECHNICAL_CHECKS_PARTIAL',
            `Some technical checks failed: ${errorMsg}. Using partial results.`,
            { url: scan.url },
            error instanceof Error ? error : undefined
        );
        
        // Create partial results with checks marked unavailable
        technical = {
            https: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            mobile: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            pagespeed: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            cls: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            ssl_chain: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            dns_safety: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            form_submission: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            links_media: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            accessibility: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            seo_basics: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            indexability: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            structured_data: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            social_metadata: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            security_headers: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            cms_version: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
            exposure: { status: 'unavailable', detail: 'Check mislukt: ' + errorMsg, score: 0 },
        };
    }

    phase('evaluating_ai');
    let ai;
    let aiError: string | undefined;
    try {
        ai = await evaluateSite(scan.scanId, artifactsPath);
    } catch (error) {
        aiError = error instanceof Error ? error.message : 'AI-analyse is niet beschikbaar.';
        scanLogger.log(
            'evaluating_ai',
            'AI_EVALUATION_FAILED',
            `AI evaluation failed: ${aiError}`,
            undefined,
            error instanceof Error ? error : undefined
        );
        // AI failure doesn't stop the scan, continue with partial results
    }

    phase('generating_report');
    try {
        await generateReport(scan.scanId, artifactsPath, technical, ai, aiError);
    } catch (error) {
        scanLogger.log(
            'generating_report',
            'REPORT_GENERATION_FAILED',
            `Report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            undefined,
            error instanceof Error ? error : undefined
        );
        throw error;
    }

    phase('completed');
    
    // On success, save error artifact if there are logged errors (like AI failures or partial technical checks)
    if (scanLogger.hasErrors()) {
        await scanLogger.saveErrorArtifact();
    }
} catch (error) {
    // Save error artifact on any fatal failure
    await scanLogger.saveErrorArtifact();
    process.exit(1);
}


