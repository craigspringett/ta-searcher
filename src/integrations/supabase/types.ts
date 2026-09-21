export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          cache_write_tokens: number
          cached_input_tokens: number
          company_search_id: string | null
          created_at: string
          details: Json | null
          duration_ms: number | null
          error: string | null
          estimated_cost_usd: number
          id: string
          input_tokens: number
          model: string
          ok: boolean
          output_tokens: number
          provider: string
          purpose: string
        }
        Insert: {
          cache_write_tokens?: number
          cached_input_tokens?: number
          company_search_id?: string | null
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error?: string | null
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model: string
          ok?: boolean
          output_tokens?: number
          provider: string
          purpose: string
        }
        Update: {
          cache_write_tokens?: number
          cached_input_tokens?: number
          company_search_id?: string | null
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error?: string | null
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          ok?: boolean
          output_tokens?: number
          provider?: string
          purpose?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_deliveries: {
        Row: {
          config_id: string
          note: string | null
          pipeline_run_id: string | null
          sent_at: string
          vacancy_id: string
        }
        Insert: {
          config_id: string
          note?: string | null
          pipeline_run_id?: string | null
          sent_at?: string
          vacancy_id: string
        }
        Update: {
          config_id?: string
          note?: string | null
          pipeline_run_id?: string | null
          sent_at?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_deliveries_config_id_fkey"
            columns: ["config_id"]
            referencedRelation: "vacancy_alert_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_deliveries_vacancy_id_fkey"
            columns: ["vacancy_id"]
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      analyze_company_queue: {
        Row: {
          dispatched_at: string | null
          enqueued_at: string
          error: string | null
          id: number
          payload: NonNullable<Json>
          prefetched_at: string | null
          request_id: number | null
          target_url: string
        }
        Insert: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          id?: number
          payload: NonNullable<Json>
          prefetched_at?: string | null
          request_id?: number | null
          target_url: string
        }
        Update: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          id?: number
          payload?: NonNullable<Json>
          prefetched_at?: string | null
          request_id?: number | null
          target_url?: string
        }
        Relationships: []
      }
      analyze_company_requests: {
        Row: {
          company_url: string | null
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          company_url?: string | null
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          company_url?: string | null
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: NonNullable<Json>
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: NonNullable<Json>
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: NonNullable<Json>
        }
        Relationships: []
      }
      ats_boards: {
        Row: {
          board_url: string | null
          company_search_id: string
          confirmed_at: string | null
          created_at: string
          last_checked_at: string | null
          last_count: number | null
          last_ok_at: string | null
          note: string | null
          provider: string
          slug: string
          updated_at: string
        }
        Insert: {
          board_url?: string | null
          company_search_id: string
          confirmed_at?: string | null
          created_at?: string
          last_checked_at?: string | null
          last_count?: number | null
          last_ok_at?: string | null
          note?: string | null
          provider: string
          slug: string
          updated_at?: string
        }
        Update: {
          board_url?: string | null
          company_search_id?: string
          confirmed_at?: string | null
          created_at?: string
          last_checked_at?: string | null
          last_count?: number | null
          last_ok_at?: string | null
          note?: string | null
          provider?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ats_boards_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      ch_filings: {
        Row: {
          category: string
          company_number: string
          created_at: string
          date: string
          description: string
          filing_key: string
          first_seen_at: string
          id: string
          raw: Json | null
          transaction_id: string | null
          type: string
        }
        Insert: {
          category?: string
          company_number: string
          created_at?: string
          date: string
          description: string
          filing_key: string
          first_seen_at?: string
          id?: string
          raw?: Json | null
          transaction_id?: string | null
          type: string
        }
        Update: {
          category?: string
          company_number?: string
          created_at?: string
          date?: string
          description?: string
          filing_key?: string
          first_seen_at?: string
          id?: string
          raw?: Json | null
          transaction_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ch_filings_company_number_fkey"
            columns: ["company_number"]
            referencedRelation: "company_records"
            referencedColumns: ["company_number"]
          },
        ]
      }
      ch_officers: {
        Row: {
          appointed_on: string | null
          company_number: string
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          name: string
          officer_id: string | null
          officer_key: string
          raw: Json | null
          resigned_on: string | null
          role: string
          updated_at: string
        }
        Insert: {
          appointed_on?: string | null
          company_number: string
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name: string
          officer_id?: string | null
          officer_key: string
          raw?: Json | null
          resigned_on?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          appointed_on?: string | null
          company_number?: string
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string
          officer_id?: string | null
          officer_key?: string
          raw?: Json | null
          resigned_on?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ch_officers_company_number_fkey"
            columns: ["company_number"]
            referencedRelation: "company_records"
            referencedColumns: ["company_number"]
          },
        ]
      }
      company_consultants: {
        Row: {
          company_search_id: string
          consultant_id: string
          created_at: string
        }
        Insert: {
          company_search_id: string
          consultant_id: string
          created_at?: string
        }
        Update: {
          company_search_id?: string
          consultant_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_consultants_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_consultants_consultant_id_fkey"
            columns: ["consultant_id"]
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      company_contact_edits: {
        Row: {
          action: string
          company_search_id: string
          contact_key: string
          created_at: string
          edited_by: string | null
          edited_by_name: string | null
          email: string | null
          id: string
          name: string | null
          note: string | null
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          action: string
          company_search_id: string
          contact_key: string
          created_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          email?: string | null
          id?: string
          name?: string | null
          note?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          company_search_id?: string
          contact_key?: string
          created_at?: string
          edited_by?: string | null
          edited_by_name?: string | null
          email?: string | null
          id?: string
          name?: string | null
          note?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_contact_edits_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_contact_edits_edited_by_fkey"
            columns: ["edited_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_copy: {
        Row: {
          company_search_id: string
          contact: Json | null
          copy: NonNullable<Json>
          created_at: string
          evidence_fingerprint: string | null
          generated_at: string
          id: string
          model: string
          persona: string
          quality_flags: string[]
          trigger: string
        }
        Insert: {
          company_search_id: string
          contact?: Json | null
          copy: NonNullable<Json>
          created_at?: string
          evidence_fingerprint?: string | null
          generated_at?: string
          id?: string
          model: string
          persona: string
          quality_flags?: string[]
          trigger?: string
        }
        Update: {
          company_search_id?: string
          contact?: Json | null
          copy?: NonNullable<Json>
          created_at?: string
          evidence_fingerprint?: string | null
          generated_at?: string
          id?: string
          model?: string
          persona?: string
          quality_flags?: string[]
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_copy_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_facts: {
        Row: {
          active: boolean
          company_search_id: string
          created_at: string
          date_hint: string | null
          first_seen: string
          id: string
          kind: string
          last_seen: string
          quote: string
          source_url: string
          statement: string
          statement_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_search_id: string
          created_at?: string
          date_hint?: string | null
          first_seen?: string
          id?: string
          kind: string
          last_seen?: string
          quote: string
          source_url: string
          statement: string
          statement_key: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_search_id?: string
          created_at?: string
          date_hint?: string | null
          first_seen?: string
          id?: string
          kind?: string
          last_seen?: string
          quote?: string
          source_url?: string
          statement?: string
          statement_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_facts_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_records: {
        Row: {
          accounts_type: string | null
          company_number: string
          created_at: string
          fetched_at: string
          incorporation_date: string | null
          last_accounts_made_up_to: string | null
          last_confirmation_statement: string | null
          name: string
          note: string | null
          postcode_district: string | null
          previous_names: string[]
          raw: Json | null
          registered_office: Json | null
          sic_codes: string[]
          status: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          accounts_type?: string | null
          company_number: string
          created_at?: string
          fetched_at?: string
          incorporation_date?: string | null
          last_accounts_made_up_to?: string | null
          last_confirmation_statement?: string | null
          name: string
          note?: string | null
          postcode_district?: string | null
          previous_names?: string[]
          raw?: Json | null
          registered_office?: Json | null
          sic_codes?: string[]
          status?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          accounts_type?: string | null
          company_number?: string
          created_at?: string
          fetched_at?: string
          incorporation_date?: string | null
          last_accounts_made_up_to?: string | null
          last_confirmation_statement?: string | null
          name?: string
          note?: string | null
          postcode_district?: string | null
          previous_names?: string[]
          raw?: Json | null
          registered_office?: Json | null
          sic_codes?: string[]
          status?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      company_refresh_runs: {
        Row: {
          company_search_id: string | null
          degraded: boolean
          error: string | null
          finished_at: string | null
          id: string
          notes: Json | null
          sources_ok: string[]
          sources_tried: string[]
          started_at: string
          vacancies_found: number
        }
        Insert: {
          company_search_id?: string | null
          degraded?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          sources_ok?: string[]
          sources_tried?: string[]
          started_at?: string
          vacancies_found?: number
        }
        Update: {
          company_search_id?: string | null
          degraded?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          sources_ok?: string[]
          sources_tried?: string[]
          started_at?: string
          vacancies_found?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_refresh_runs_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_scores: {
        Row: {
          breakdown: NonNullable<Json>
          company_search_id: string
          computed_at: string
          score: number
          signals_computed_at: string | null
          top_code: string | null
          top_reason: string | null
        }
        Insert: {
          breakdown?: NonNullable<Json>
          company_search_id: string
          computed_at?: string
          score: number
          signals_computed_at?: string | null
          top_code?: string | null
          top_reason?: string | null
        }
        Update: {
          breakdown?: NonNullable<Json>
          company_search_id?: string
          computed_at?: string
          score?: number
          signals_computed_at?: string | null
          top_code?: string | null
          top_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_scores_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_searches: {
        Row: {
          analysis_result: NonNullable<Json>
          company_name: string
          company_number: string | null
          created_at: string
          evidence_computed_at: string | null
          evidence_fingerprint: string | null
          external_refs: NonNullable<Json>
          id: string
          updated_at: string
          url: string
        }
        Insert: {
          analysis_result: NonNullable<Json>
          company_name: string
          company_number?: string | null
          created_at?: string
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          external_refs?: NonNullable<Json>
          id?: string
          updated_at?: string
          url: string
        }
        Update: {
          analysis_result?: NonNullable<Json>
          company_name?: string
          company_number?: string | null
          created_at?: string
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          external_refs?: NonNullable<Json>
          id?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      company_signals: {
        Row: {
          code: string
          company_search_id: string
          computed_at: string
          evidence: NonNullable<Json>
          explanation: string
          id: string
          label: string
          strength: number
        }
        Insert: {
          code: string
          company_search_id: string
          computed_at?: string
          evidence?: NonNullable<Json>
          explanation: string
          id?: string
          label: string
          strength: number
        }
        Update: {
          code?: string
          company_search_id?: string
          computed_at?: string
          evidence?: NonNullable<Json>
          explanation?: string
          id?: string
          label?: string
          strength?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_signals_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      consultants: {
        Row: {
          active: boolean
          brief_copies: string[]
          created_at: string
          email: string | null
          external_refs: NonNullable<Json>
          id: string
          name: string
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          brief_copies?: string[]
          created_at?: string
          email?: string | null
          external_refs?: NonNullable<Json>
          id?: string
          name: string
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          brief_copies?: string[]
          created_at?: string
          email?: string | null
          external_refs?: NonNullable<Json>
          id?: string
          name?: string
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultants_profile_id_fkey"
            columns: ["profile_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_feedback: {
        Row: {
          company_search_id: string
          contact_name: string | null
          contact_role: string | null
          created_at: string
          email: string | null
          id: string
          kind: string
          reporter_email: string | null
        }
        Insert: {
          company_search_id: string
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind: string
          reporter_email?: string | null
        }
        Update: {
          company_search_id?: string
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          reporter_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_feedback_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_queue: {
        Row: {
          company_search_id: string
          dispatched_at: string | null
          enqueued_at: string
          error: string | null
          force: boolean
          id: number
          personas: string[]
          request_id: number | null
          trigger: string
        }
        Insert: {
          company_search_id: string
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          force?: boolean
          id?: number
          personas: string[]
          request_id?: number | null
          trigger?: string
        }
        Update: {
          company_search_id?: string
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          force?: boolean
          id?: number
          personas?: string[]
          request_id?: number | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "copy_queue_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          company_search_id: string | null
          consultant_id: string | null
          contact_name: string | null
          created_at: string
          dedupe_key: string
          email_id: string | null
          event_type: string
          id: string
          message_id: string | null
          occurred_at: string
          raw: Json | null
          recipient_email: string
          url: string | null
        }
        Insert: {
          company_search_id?: string | null
          consultant_id?: string | null
          contact_name?: string | null
          created_at?: string
          dedupe_key: string
          email_id?: string | null
          event_type: string
          id?: string
          message_id?: string | null
          occurred_at: string
          raw?: Json | null
          recipient_email: string
          url?: string | null
        }
        Update: {
          company_search_id?: string | null
          consultant_id?: string | null
          contact_name?: string | null
          created_at?: string
          dedupe_key?: string
          email_id?: string | null
          event_type?: string
          id?: string
          message_id?: string | null
          occurred_at?: string
          raw?: Json | null
          recipient_email?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_consultant_id_fkey"
            columns: ["consultant_id"]
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_signatures: {
        Row: {
          email: string
          full_name: string
          job_title: string
          linkedin_url: string
          mobile: string
          office_phone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          email: string
          full_name: string
          job_title?: string
          linkedin_url?: string
          mobile?: string
          office_phone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          email?: string
          full_name?: string
          job_title?: string
          linkedin_url?: string
          mobile?: string
          office_phone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_signatures_updated_by_fkey"
            columns: ["updated_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      funding_news: {
        Row: {
          amount_gbp: number | null
          amount_text: string | null
          company_name: string | null
          created_at: string
          external_key: string
          first_seen_at: string
          id: string
          match_note: string | null
          matched_company_search_id: string | null
          published_at: string | null
          publisher: string | null
          round: string | null
          source: string
          summary: string | null
          title: string
          url: string
        }
        Insert: {
          amount_gbp?: number | null
          amount_text?: string | null
          company_name?: string | null
          created_at?: string
          external_key: string
          first_seen_at?: string
          id?: string
          match_note?: string | null
          matched_company_search_id?: string | null
          published_at?: string | null
          publisher?: string | null
          round?: string | null
          source: string
          summary?: string | null
          title: string
          url: string
        }
        Update: {
          amount_gbp?: number | null
          amount_text?: string | null
          company_name?: string | null
          created_at?: string
          external_key?: string
          first_seen_at?: string
          id?: string
          match_note?: string | null
          matched_company_search_id?: string | null
          published_at?: string | null
          publisher?: string | null
          round?: string | null
          source?: string
          summary?: string | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_news_matched_company_fkey"
            columns: ["matched_company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      outcomes: {
        Row: {
          callback_at: string | null
          company_search_id: string
          consultant_id: string | null
          contact_name: string | null
          contact_role: string | null
          created_at: string
          created_by: string | null
          external_refs: NonNullable<Json>
          id: string
          kind: string
          note: string | null
          updated_at: string
        }
        Insert: {
          callback_at?: string | null
          company_search_id: string
          consultant_id?: string | null
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          created_by?: string | null
          external_refs?: NonNullable<Json>
          id?: string
          kind: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          callback_at?: string | null
          company_search_id?: string
          consultant_id?: string | null
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          created_by?: string | null
          external_refs?: NonNullable<Json>
          id?: string
          kind?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_consultant_id_fkey"
            columns: ["consultant_id"]
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          companies_refreshed_today: number | null
          companies_total: number | null
          config_id: string | null
          details: Json | null
          error: string | null
          finished_at: string | null
          id: string
          new_count: number | null
          phase: string
          started_at: string
          status: string
        }
        Insert: {
          companies_refreshed_today?: number | null
          companies_total?: number | null
          config_id?: string | null
          details?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          new_count?: number | null
          phase: string
          started_at?: string
          status?: string
        }
        Update: {
          companies_refreshed_today?: number | null
          companies_total?: number | null
          config_id?: string | null
          details?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          new_count?: number | null
          phase?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          consultant_id: string | null
          created_at: string
          display_name: string | null
          email: string
          features: NonNullable<Json>
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          features?: NonNullable<Json>
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          features?: NonNullable<Json>
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      vacancies: {
        Row: {
          closing_date: string | null
          company_search_id: string | null
          created_at: string
          employer_name: string | null
          external_refs: NonNullable<Json>
          first_seen: string
          id: string
          last_seen: string
          raw: Json | null
          rejected_reason: string | null
          source: Database["public"]["Enums"]["vacancy_source"]
          start_text: string | null
          status: string
          title: string
          updated_at: string
          url: string | null
          vacancy_key: string
        }
        Insert: {
          closing_date?: string | null
          company_search_id?: string | null
          created_at?: string
          employer_name?: string | null
          external_refs?: NonNullable<Json>
          first_seen?: string
          id?: string
          last_seen?: string
          raw?: Json | null
          rejected_reason?: string | null
          source?: Database["public"]["Enums"]["vacancy_source"]
          start_text?: string | null
          status?: string
          title: string
          updated_at?: string
          url?: string | null
          vacancy_key: string
        }
        Update: {
          closing_date?: string | null
          company_search_id?: string | null
          created_at?: string
          employer_name?: string | null
          external_refs?: NonNullable<Json>
          first_seen?: string
          id?: string
          last_seen?: string
          raw?: Json | null
          rejected_reason?: string | null
          source?: Database["public"]["Enums"]["vacancy_source"]
          start_text?: string | null
          status?: string
          title?: string
          updated_at?: string
          url?: string | null
          vacancy_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacancies_company_search_id_fkey"
            columns: ["company_search_id"]
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancy_alert_settings: {
        Row: {
          alert_type: string
          auto_refresh_enabled: boolean
          consultant_filter: string | null
          consultant_id: string | null
          created_at: string
          daily_alerts: boolean
          email: string
          enabled: boolean
          extra_recipients: string[]
          id: string
          la_filter: string | null
          name: string | null
          updated_at: string
          weekly_alerts: boolean
        }
        Insert: {
          alert_type?: string
          auto_refresh_enabled?: boolean
          consultant_filter?: string | null
          consultant_id?: string | null
          created_at?: string
          daily_alerts?: boolean
          email: string
          enabled?: boolean
          extra_recipients?: string[]
          id?: string
          la_filter?: string | null
          name?: string | null
          updated_at?: string
          weekly_alerts?: boolean
        }
        Update: {
          alert_type?: string
          auto_refresh_enabled?: boolean
          consultant_filter?: string | null
          consultant_id?: string | null
          created_at?: string
          daily_alerts?: boolean
          email?: string
          enabled?: boolean
          extra_recipients?: string[]
          id?: string
          la_filter?: string | null
          name?: string | null
          updated_at?: string
          weekly_alerts?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_alert_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancy_feedback: {
        Row: {
          created_at: string
          id: string
          kind: string
          reporter_email: string | null
          token: string | null
          vacancy_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          reporter_email?: string | null
          token?: string | null
          vacancy_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          reporter_email?: string | null
          token?: string | null
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_feedback_vacancy_id_fkey"
            columns: ["vacancy_id"]
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_role: { Args: Record<PropertyKey, never>; Returns: string }
      auth_before_user_created: { Args: { event: Json }; Returns: Json }
      close_stale_refresh_runs: {
        Args: { p_minutes?: number }
        Returns: number
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dispatch_analyze_company_queue: {
        Args: { batch_size?: number; spacing_seconds?: number }
        Returns: number
      }
      dispatch_copy_queue: { Args: { batch_size?: number }; Returns: number }
      display_name_from_email: { Args: { p_email: string }; Returns: string }
      enqueue_analyze_company_batch: {
        Args: { auth_token: string; payloads: Json; target_url: string }
        Returns: number
      }
      enqueue_copy_generation: {
        Args: {
          p_company_id: string
          p_force?: boolean
          p_nightly_cap?: number
          p_personas: string[]
          p_trigger?: string
        }
        Returns: string
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_ai_usage_summary: { Args: Record<PropertyKey, never>; Returns: Json }
      get_cron_last_run: { Args: { p_jobid: number }; Returns: Json }
      get_cron_monitoring_jobs_only: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_cron_monitoring_status: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_cron_recent_runs: {
        Args: { p_jobid: number; p_limit?: number }
        Returns: Json
      }
      get_pipeline_health: { Args: Record<PropertyKey, never>; Returns: Json }
      get_vacancy_email_counters: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      has_feature: { Args: { p_feature: string }; Returns: boolean }
      http_page_enqueue: {
        Args: { p_timeout_ms?: number; p_url: string }
        Returns: number
      }
      http_page_result: { Args: { p_id: number }; Returns: Json }
      invoke_edge_function: {
        Args: { function_name: string; payload?: Json }
        Returns: number
      }
      is_allowed_login_email: { Args: { p_email: string }; Returns: boolean }
      is_app_user: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_manager: { Args: Record<PropertyKey, never>; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      my_consultant_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      owns_alert_setting: {
        Args: { p_consultant_id: string; p_email: string }
        Returns: boolean
      }
      process_email_queue_tick: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      set_analysis_signals: {
        Args: { p_company_id: string; p_facts: Json; p_signals: Json }
        Returns: undefined
      }
      set_company_copy: {
        Args: {
          p_cold_call?: string
          p_company_id: string
          p_copy: Json
          p_persona: string
          p_warm_email?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      vacancy_source:
        | "ashby"
        | "greenhouse"
        | "lever"
        | "workable"
        | "careers_page"
        | "llm"
        | "consultant"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      vacancy_source: [
        "ashby",
        "greenhouse",
        "lever",
        "workable",
        "careers_page",
        "llm",
        "consultant",
        "other",
      ],
    },
  },
} as const
