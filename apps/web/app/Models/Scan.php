<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class Scan extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $hidden = ['results', 'error_detail'];

    public function saveResults(array $results): void
    {
        $results = Arr::only($results, ['home', 'technical', 'ai', 'aiError', 'generatedAt']);
        $results['home'] = Arr::only($results['home'] ?? [], ['title', 'url']);
        
        $validator = Validator::make($results, [
            'home' => ['required', 'array:title,url'],
            'home.title' => ['present', 'nullable', 'string'],
            'home.url' => ['required', 'string', 'url:http,https'],
            'technical' => ['required', 'array:https,mobile,pagespeed,cls,ssl_chain,dns_safety,form_submission,links_media,accessibility,seo_basics,indexability,structured_data,social_metadata,security_headers,cms_version,exposure'],
            'technical.*' => ['required', 'array:status,score,detail'],
            'technical.*.status' => ['required', 'in:pass,warning,fail,unavailable'],
            'technical.*.score' => ['required', 'numeric', 'between:0,100'],
            'technical.*.detail' => ['required', 'string', 'max:1000'],
            'ai' => ['sometimes', 'nullable', 'array:criteria'],
            'ai.criteria' => ['required_with:ai', 'array:beeldgebruik,call_to_action,actualiteit,informatiearchitectuur,vrijwilligerswerving,taalgebruik,contact_avg,mobiele_ervaring,brand_consistency'],
            'ai.criteria.*' => ['array:score,toelichting,verbeterpunt,insufficientEvidence'],
            'ai.criteria.*.score' => ['required', 'integer', 'between:1,5'],
            'ai.criteria.*.toelichting' => ['required', 'string', 'max:600'],
            'ai.criteria.*.verbeterpunt' => ['required', 'string', 'max:600'],
            'ai.criteria.*.insufficientEvidence' => ['sometimes', 'boolean'],
            'aiError' => ['sometimes', 'nullable', 'string'],
            'generatedAt' => ['required', 'date'],
        ]);

        if ($validator->fails()) {
            // Log detailed validation failures for debugging
            Log::error('Scan results validation failed', [
                'scan_id' => $this->id,
                'url' => $this->url,
                'errors' => $validator->errors()->toArray(),
                'results_keys' => array_keys($results),
                'technical_keys' => array_keys($results['technical'] ?? []),
            ]);
            
            // Throw with detailed error message
            $validator->validate();
        }

        $this->update(['results' => $results]);
    }

    protected function casts(): array
    {
        return [
            'active_security_checks' => 'boolean',
            'form_submission_testing_authorized' => 'boolean',
            'can_retry' => 'boolean',
            'completed_at' => 'datetime',
            'results' => 'array',
        ];
    }
}