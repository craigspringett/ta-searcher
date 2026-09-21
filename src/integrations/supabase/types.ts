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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agency_adverts: {
        Row: {
          active: boolean
          agency: string | null
          board: string
          created_at: string
          first_seen: string
          id: string
          last_seen: string
          location: string | null
          match_reason: string | null
          raw: Json | null
          company_search_id: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          agency?: string | null
          board: string
          created_at?: string
          first_seen?: string
          id?: string
          last_seen?: string
          location?: string | null
          match_reason?: string | null
          raw?: Json | null
          company_search_id: string
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          agency?: string | null
          board?: string
          created_at?: string
          first_seen?: string
          id?: string
          last_seen?: string
          location?: string | null
          match_reason?: string | null
          raw?: Json | null
          company_search_id?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_adverts_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_board_listings: {
        Row: {
          active: boolean
          agency: string | null
          board: string
          ends_at: string | null
          external_id: string
          first_seen: string
          last_seen: string
          location: string | null
          postcode: string | null
          posted_at: string | null
          raw: Json | null
          text_head: string | null
          title: string
          url: string
        }
        Insert: {
          active?: boolean
          agency?: string | null
          board: string
          ends_at?: string | null
          external_id: string
          first_seen?: string
          last_seen?: string
          location?: string | null
          postcode?: string | null
          posted_at?: string | null
          raw?: Json | null
          text_head?: string | null
          title: string
          url: string
        }
        Update: {
          active?: boolean
          agency?: string | null
          board?: string
          ends_at?: string | null
          external_id?: string
          first_seen?: string
          last_seen?: string
          location?: string | null
          postcode?: string | null
          posted_at?: string | null
          raw?: Json | null
          text_head?: string | null
          title?: string
          url?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          cache_write_tokens: number
          cached_input_tokens: number
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
          company_search_id: string | null
        }
        Insert: {
          cache_write_tokens?: number
          cached_input_tokens?: number
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
          company_search_id?: string | null
        }
        Update: {
          cache_write_tokens?: number
          cached_input_tokens?: number
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
          company_search_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "vacancy_alert_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_deliveries_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
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
          payload: Json
          request_id: number | null
          target_url: string
        }
        Insert: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          id?: number
          payload: Json
          request_id?: number | null
          target_url: string
        }
        Update: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          id?: number
          payload?: Json
          request_id?: number | null
          target_url?: string
        }
        Relationships: []
      }
      analyze_company_requests: {
        Row: {
          created_at: string
          id: number
          company_url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          company_url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          company_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      board_employer_pages: {
        Row: {
          board: string
          checked_at: string
          employer_name: string | null
          matched_by: string | null
          company_search_id: string
          url: string
        }
        Insert: {
          board: string
          checked_at?: string
          employer_name?: string | null
          matched_by?: string | null
          company_search_id: string
          url: string
        }
        Update: {
          board?: string
          checked_at?: string
          employer_name?: string | null
          matched_by?: string | null
          company_search_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_employer_pages_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      board_fetch_log: {
        Row: {
          board: string
          last_fetch_at: string
        }
        Insert: {
          board: string
          last_fetch_at?: string
        }
        Update: {
          board?: string
          last_fetch_at?: string
        }
        Relationships: []
      }
      cfr_data: {
        Row: {
          ba030_education_support: number | null
          ba230_other_staff_costs: number | null
          ba240_supply_staff_costs: number | null
          bae10_teaching_staff: number | null
          bae20_supply_teaching_staff: number | null
          created_at: string
          e02_supply_teachers: number | null
          e26_agency_staff: number | null
          e27_other_supply_costs: number | null
          fetched_at: string | null
          fiscal_year: string
          id: string
          la_name: string
          company_name: string
          source: string | null
          total_expenditure: number | null
          updated_at: string
          urn: string | null
        }
        Insert: {
          ba030_education_support?: number | null
          ba230_other_staff_costs?: number | null
          ba240_supply_staff_costs?: number | null
          bae10_teaching_staff?: number | null
          bae20_supply_teaching_staff?: number | null
          created_at?: string
          e02_supply_teachers?: number | null
          e26_agency_staff?: number | null
          e27_other_supply_costs?: number | null
          fetched_at?: string | null
          fiscal_year: string
          id?: string
          la_name: string
          company_name: string
          source?: string | null
          total_expenditure?: number | null
          updated_at?: string
          urn?: string | null
        }
        Update: {
          ba030_education_support?: number | null
          ba230_other_staff_costs?: number | null
          ba240_supply_staff_costs?: number | null
          bae10_teaching_staff?: number | null
          bae20_supply_teaching_staff?: number | null
          created_at?: string
          e02_supply_teachers?: number | null
          e26_agency_staff?: number | null
          e27_other_supply_costs?: number | null
          fetched_at?: string | null
          fiscal_year?: string
          id?: string
          la_name?: string
          company_name?: string
          source?: string | null
          total_expenditure?: number | null
          updated_at?: string
          urn?: string | null
        }
        Relationships: []
      }
      cfr_data_quarantine_20260909: {
        Row: {
          ba030_education_support: number | null
          ba230_other_staff_costs: number | null
          ba240_supply_staff_costs: number | null
          bae10_teaching_staff: number | null
          bae20_supply_teaching_staff: number | null
          created_at: string
          e02_supply_teachers: number | null
          e26_agency_staff: number | null
          e27_other_supply_costs: number | null
          fiscal_year: string
          id: string
          la_name: string
          quarantined_at: string
          reason: string | null
          company_name: string
          total_expenditure: number | null
          updated_at: string
          urn: string | null
        }
        Insert: {
          ba030_education_support?: number | null
          ba230_other_staff_costs?: number | null
          ba240_supply_staff_costs?: number | null
          bae10_teaching_staff?: number | null
          bae20_supply_teaching_staff?: number | null
          created_at?: string
          e02_supply_teachers?: number | null
          e26_agency_staff?: number | null
          e27_other_supply_costs?: number | null
          fiscal_year: string
          id?: string
          la_name: string
          quarantined_at?: string
          reason?: string | null
          company_name: string
          total_expenditure?: number | null
          updated_at?: string
          urn?: string | null
        }
        Update: {
          ba030_education_support?: number | null
          ba230_other_staff_costs?: number | null
          ba240_supply_staff_costs?: number | null
          bae10_teaching_staff?: number | null
          bae20_supply_teaching_staff?: number | null
          created_at?: string
          e02_supply_teachers?: number | null
          e26_agency_staff?: number | null
          e27_other_supply_costs?: number | null
          fiscal_year?: string
          id?: string
          la_name?: string
          quarantined_at?: string
          reason?: string | null
          company_name?: string
          total_expenditure?: number | null
          updated_at?: string
          urn?: string | null
        }
        Relationships: []
      }
      consultants: {
        Row: {
          active: boolean
          brief_copies: string[]
          created_at: string
          email: string | null
          external_refs: Json
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
          external_refs?: Json
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
          external_refs?: Json
          id?: string
          name?: string
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_feedback: {
        Row: {
          contact_name: string | null
          contact_role: string | null
          created_at: string
          email: string | null
          id: string
          kind: string
          reporter_email: string | null
          company_search_id: string
        }
        Insert: {
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind: string
          reporter_email?: string | null
          company_search_id: string
        }
        Update: {
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          reporter_email?: string | null
          company_search_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_feedback_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_queue: {
        Row: {
          dispatched_at: string | null
          enqueued_at: string
          error: string | null
          force: boolean
          id: number
          personas: string[]
          request_id: number | null
          company_search_id: string
          trigger: string
        }
        Insert: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          force?: boolean
          id?: number
          personas: string[]
          request_id?: number | null
          company_search_id: string
          trigger?: string
        }
        Update: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          force?: boolean
          id?: number
          personas?: string[]
          request_id?: number | null
          company_search_id?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "copy_queue_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
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
          company_search_id: string | null
          url: string | null
        }
        Insert: {
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
          company_search_id?: string | null
          url?: string | null
        }
        Update: {
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
          company_search_id?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
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
      follow_up_sequences: {
        Row: {
          consultant_id: string | null
          contact_email: string
          contact_name: string
          contact_role: string | null
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          plan: Json
          company_search_id: string
          started_at: string
          status: string
          stop_reason: string | null
          updated_at: string
          vacancy_id: string | null
        }
        Insert: {
          consultant_id?: string | null
          contact_email: string
          contact_name: string
          contact_role?: string | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          plan?: Json
          company_search_id: string
          started_at?: string
          status?: string
          stop_reason?: string | null
          updated_at?: string
          vacancy_id?: string | null
        }
        Update: {
          consultant_id?: string | null
          contact_email?: string
          contact_name?: string
          contact_role?: string | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          plan?: Json
          company_search_id?: string
          started_at?: string
          status?: string
          stop_reason?: string | null
          updated_at?: string
          vacancy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_sequences_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_sequences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_sequences_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_sequences_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_steps: {
        Row: {
          body: string | null
          completed_at: string | null
          created_at: string
          day: number
          draft_context_key: string | null
          draft_flags: string[]
          draft_generated_at: string | null
          due_at: string
          hook: string | null
          id: string
          kind: string
          label: string | null
          outcome_id: string | null
          sent_message_id: string | null
          sequence_id: string
          status: string
          step_no: number
          subject: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          completed_at?: string | null
          created_at?: string
          day?: number
          draft_context_key?: string | null
          draft_flags?: string[]
          draft_generated_at?: string | null
          due_at: string
          hook?: string | null
          id?: string
          kind: string
          label?: string | null
          outcome_id?: string | null
          sent_message_id?: string | null
          sequence_id: string
          status?: string
          step_no: number
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          completed_at?: string | null
          created_at?: string
          day?: number
          draft_context_key?: string | null
          draft_flags?: string[]
          draft_generated_at?: string | null
          due_at?: string
          hook?: string | null
          id?: string
          kind?: string
          label?: string | null
          outcome_id?: string | null
          sent_message_id?: string | null
          sequence_id?: string
          status?: string
          step_no?: number
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_steps_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      gias_census_history: {
        Row: {
          capacity: number | null
          census_date: string
          created_at: string
          extract_date: string | null
          pct_fsm: number | null
          pupils: number | null
          urn: string
        }
        Insert: {
          capacity?: number | null
          census_date: string
          created_at?: string
          extract_date?: string | null
          pct_fsm?: number | null
          pupils?: number | null
          urn: string
        }
        Update: {
          capacity?: number | null
          census_date?: string
          created_at?: string
          extract_date?: string | null
          pct_fsm?: number | null
          pupils?: number | null
          urn?: string
        }
        Relationships: []
      }
      gias_establishments: {
        Row: {
          capacity: number | null
          census_date: string | null
          close_date: string | null
          created_at: string
          easting: number | null
          extract_date: string | null
          federation_name: string | null
          fetched_at: string
          gss_la_code: string | null
          head_name: string | null
          high_age: number | null
          in_patch: boolean
          la_code: string | null
          la_name: string | null
          last_changed: string | null
          lat: number | null
          lon: number | null
          low_age: number | null
          name: string
          needs_framework_route: boolean
          northing: number | null
          open_date: string | null
          pct_fsm: number | null
          phase: string | null
          phase_norm: string | null
          postcode: string | null
          postcode_district: string | null
          pupils: number | null
          reason_opened: string | null
          status: string | null
          telephone: string | null
          trust_code: string | null
          trust_flag: string | null
          trust_name: string | null
          type: string | null
          type_group: string | null
          updated_at: string
          urn: string
          website: string | null
        }
        Insert: {
          capacity?: number | null
          census_date?: string | null
          close_date?: string | null
          created_at?: string
          easting?: number | null
          extract_date?: string | null
          federation_name?: string | null
          fetched_at?: string
          gss_la_code?: string | null
          head_name?: string | null
          high_age?: number | null
          in_patch?: boolean
          la_code?: string | null
          la_name?: string | null
          last_changed?: string | null
          lat?: number | null
          lon?: number | null
          low_age?: number | null
          name: string
          needs_framework_route?: boolean
          northing?: number | null
          open_date?: string | null
          pct_fsm?: number | null
          phase?: string | null
          phase_norm?: string | null
          postcode?: string | null
          postcode_district?: string | null
          pupils?: number | null
          reason_opened?: string | null
          status?: string | null
          telephone?: string | null
          trust_code?: string | null
          trust_flag?: string | null
          trust_name?: string | null
          type?: string | null
          type_group?: string | null
          updated_at?: string
          urn: string
          website?: string | null
        }
        Update: {
          capacity?: number | null
          census_date?: string | null
          close_date?: string | null
          created_at?: string
          easting?: number | null
          extract_date?: string | null
          federation_name?: string | null
          fetched_at?: string
          gss_la_code?: string | null
          head_name?: string | null
          high_age?: number | null
          in_patch?: boolean
          la_code?: string | null
          la_name?: string | null
          last_changed?: string | null
          lat?: number | null
          lon?: number | null
          low_age?: number | null
          name?: string
          needs_framework_route?: boolean
          northing?: number | null
          open_date?: string | null
          pct_fsm?: number | null
          phase?: string | null
          phase_norm?: string | null
          postcode?: string | null
          postcode_district?: string | null
          pupils?: number | null
          reason_opened?: string | null
          status?: string | null
          telephone?: string | null
          trust_code?: string | null
          trust_flag?: string | null
          trust_name?: string | null
          type?: string | null
          type_group?: string | null
          updated_at?: string
          urn?: string
          website?: string | null
        }
        Relationships: []
      }
      gias_head_changes: {
        Row: {
          created_at: string
          extract_date: string | null
          id: string
          new_head: string | null
          new_head_job_title: string | null
          noticed_at: string
          previous_head: string | null
          urn: string
        }
        Insert: {
          created_at?: string
          extract_date?: string | null
          id?: string
          new_head?: string | null
          new_head_job_title?: string | null
          noticed_at?: string
          previous_head?: string | null
          urn: string
        }
        Update: {
          created_at?: string
          extract_date?: string | null
          id?: string
          new_head?: string | null
          new_head_job_title?: string | null
          noticed_at?: string
          previous_head?: string | null
          urn?: string
        }
        Relationships: []
      }
      gias_heads: {
        Row: {
          establishment_name: string | null
          extract_date: string | null
          fetched_at: string
          head_first_name: string | null
          head_job_title: string | null
          head_last_name: string | null
          head_title: string | null
          la_name: string | null
          phase: string | null
          postcode: string | null
          status: string | null
          telephone: string | null
          trust_name: string | null
          urn: string
          website: string | null
        }
        Insert: {
          establishment_name?: string | null
          extract_date?: string | null
          fetched_at?: string
          head_first_name?: string | null
          head_job_title?: string | null
          head_last_name?: string | null
          head_title?: string | null
          la_name?: string | null
          phase?: string | null
          postcode?: string | null
          status?: string | null
          telephone?: string | null
          trust_name?: string | null
          urn: string
          website?: string | null
        }
        Update: {
          establishment_name?: string | null
          extract_date?: string | null
          fetched_at?: string
          head_first_name?: string | null
          head_job_title?: string | null
          head_last_name?: string | null
          head_title?: string | null
          la_name?: string | null
          phase?: string | null
          postcode?: string | null
          status?: string | null
          telephone?: string | null
          trust_name?: string | null
          urn?: string
          website?: string | null
        }
        Relationships: []
      }
      gias_trust_changes: {
        Row: {
          created_at: string
          extract_date: string | null
          id: string
          new_trust_name: string | null
          new_trust_uid: string | null
          noticed_at: string
          previous_trust_name: string | null
          previous_trust_uid: string | null
          urn: string
        }
        Insert: {
          created_at?: string
          extract_date?: string | null
          id?: string
          new_trust_name?: string | null
          new_trust_uid?: string | null
          noticed_at?: string
          previous_trust_name?: string | null
          previous_trust_uid?: string | null
          urn: string
        }
        Update: {
          created_at?: string
          extract_date?: string | null
          id?: string
          new_trust_name?: string | null
          new_trust_uid?: string | null
          noticed_at?: string
          previous_trust_name?: string | null
          previous_trust_uid?: string | null
          urn?: string
        }
        Relationships: []
      }
      ofsted_changes: {
        Row: {
          created_at: string
          current: Json
          id: string
          noticed_at: string
          previous: Json | null
          summary: string
          urn: string
        }
        Insert: {
          created_at?: string
          current: Json
          id?: string
          noticed_at?: string
          previous?: Json | null
          summary: string
          urn: string
        }
        Update: {
          created_at?: string
          current?: Json
          id?: string
          noticed_at?: string
          previous?: Json | null
          summary?: string
          urn?: string
        }
        Relationships: []
      }
      ofsted_outcomes: {
        Row: {
          category_of_concern: string | null
          created_at: string
          extract_date: string | null
          fetched_at: string
          grades: Json
          inspection_date: string | null
          inspection_number: string | null
          inspection_type: string | null
          most_recent_category_of_concern: string | null
          oeif_inspection_date: string | null
          oeif_overall: string | null
          oeif_publication_date: string | null
          ofsted_phase: string | null
          publication_date: string | null
          report_url: string | null
          company_name: string | null
          ungraded_date: string | null
          ungraded_outcome: string | null
          ungraded_publication_date: string | null
          updated_at: string
          urn: string
        }
        Insert: {
          category_of_concern?: string | null
          created_at?: string
          extract_date?: string | null
          fetched_at?: string
          grades?: Json
          inspection_date?: string | null
          inspection_number?: string | null
          inspection_type?: string | null
          most_recent_category_of_concern?: string | null
          oeif_inspection_date?: string | null
          oeif_overall?: string | null
          oeif_publication_date?: string | null
          ofsted_phase?: string | null
          publication_date?: string | null
          report_url?: string | null
          company_name?: string | null
          ungraded_date?: string | null
          ungraded_outcome?: string | null
          ungraded_publication_date?: string | null
          updated_at?: string
          urn: string
        }
        Update: {
          category_of_concern?: string | null
          created_at?: string
          extract_date?: string | null
          fetched_at?: string
          grades?: Json
          inspection_date?: string | null
          inspection_number?: string | null
          inspection_type?: string | null
          most_recent_category_of_concern?: string | null
          oeif_inspection_date?: string | null
          oeif_overall?: string | null
          oeif_publication_date?: string | null
          ofsted_phase?: string | null
          publication_date?: string | null
          report_url?: string | null
          company_name?: string | null
          ungraded_date?: string | null
          ungraded_outcome?: string | null
          ungraded_publication_date?: string | null
          updated_at?: string
          urn?: string
        }
        Relationships: []
      }
      outcomes: {
        Row: {
          callback_at: string | null
          consultant_id: string | null
          contact_name: string | null
          contact_role: string | null
          created_at: string
          created_by: string | null
          external_refs: Json
          id: string
          kind: string
          note: string | null
          company_search_id: string
          updated_at: string
        }
        Insert: {
          callback_at?: string | null
          consultant_id?: string | null
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          created_by?: string | null
          external_refs?: Json
          id?: string
          kind: string
          note?: string | null
          company_search_id: string
          updated_at?: string
        }
        Update: {
          callback_at?: string | null
          consultant_id?: string | null
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          created_by?: string | null
          external_refs?: Json
          id?: string
          kind?: string
          note?: string | null
          company_search_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          config_id: string | null
          details: Json | null
          error: string | null
          finished_at: string | null
          id: string
          new_count: number | null
          phase: string
          companies_refreshed_today: number | null
          companies_total: number | null
          started_at: string
          status: string
        }
        Insert: {
          config_id?: string | null
          details?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          new_count?: number | null
          phase: string
          companies_refreshed_today?: number | null
          companies_total?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          config_id?: string | null
          details?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          new_count?: number | null
          phase?: string
          companies_refreshed_today?: number | null
          companies_total?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      probe_requests: {
        Row: {
          created_at: string | null
          label: string | null
          request_id: number | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          label?: string | null
          request_id?: number | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          label?: string | null
          request_id?: number | null
          url?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          consultant_id: string | null
          created_at: string
          display_name: string | null
          email: string
          features: Json
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          features?: Json
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          features?: Json
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_census: {
        Row: {
          auxiliary_staff_fte: number | null
          created_at: string
          fetched_at: string
          fiscal_year: string
          pct_qualified_teachers: number | null
          senior_leadership_fte: number | null
          source: string
          support_staff_fte: number | null
          teachers_fte: number | null
          teaching_assistants_fte: number | null
          total_pupils: number | null
          updated_at: string
          urn: string
          workforce_fte: number | null
          workforce_headcount: number | null
          year_end: number
        }
        Insert: {
          auxiliary_staff_fte?: number | null
          created_at?: string
          fetched_at?: string
          fiscal_year: string
          pct_qualified_teachers?: number | null
          senior_leadership_fte?: number | null
          source?: string
          support_staff_fte?: number | null
          teachers_fte?: number | null
          teaching_assistants_fte?: number | null
          total_pupils?: number | null
          updated_at?: string
          urn: string
          workforce_fte?: number | null
          workforce_headcount?: number | null
          year_end: number
        }
        Update: {
          auxiliary_staff_fte?: number | null
          created_at?: string
          fetched_at?: string
          fiscal_year?: string
          pct_qualified_teachers?: number | null
          senior_leadership_fte?: number | null
          source?: string
          support_staff_fte?: number | null
          teachers_fte?: number | null
          teaching_assistants_fte?: number | null
          total_pupils?: number | null
          updated_at?: string
          urn?: string
          workforce_fte?: number | null
          workforce_headcount?: number | null
          year_end?: number
        }
        Relationships: []
      }
      company_consultants: {
        Row: {
          consultant_id: string
          created_at: string
          company_search_id: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          company_search_id: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          company_search_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_consultants_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_consultants_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_contact_edits: {
        Row: {
          action: string
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
          company_search_id: string
          updated_at: string
        }
        Insert: {
          action: string
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
          company_search_id: string
          updated_at?: string
        }
        Update: {
          action?: string
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
          company_search_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_contact_edits_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_contact_edits_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_copy: {
        Row: {
          contact: Json | null
          copy: Json
          created_at: string
          evidence_fingerprint: string | null
          generated_at: string
          id: string
          model: string
          persona: string
          quality_flags: string[]
          company_search_id: string
          trigger: string
        }
        Insert: {
          contact?: Json | null
          copy: Json
          created_at?: string
          evidence_fingerprint?: string | null
          generated_at?: string
          id?: string
          model: string
          persona: string
          quality_flags?: string[]
          company_search_id: string
          trigger?: string
        }
        Update: {
          contact?: Json | null
          copy?: Json
          created_at?: string
          evidence_fingerprint?: string | null
          generated_at?: string
          id?: string
          model?: string
          persona?: string
          quality_flags?: string[]
          company_search_id?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_copy_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_facts: {
        Row: {
          active: boolean
          created_at: string
          date_hint: string | null
          first_seen: string
          id: string
          kind: string
          last_seen: string
          quote: string
          company_search_id: string
          source_url: string
          statement: string
          statement_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          date_hint?: string | null
          first_seen?: string
          id?: string
          kind: string
          last_seen?: string
          quote: string
          company_search_id: string
          source_url: string
          statement: string
          statement_key: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          date_hint?: string | null
          first_seen?: string
          id?: string
          kind?: string
          last_seen?: string
          quote?: string
          company_search_id?: string
          source_url?: string
          statement?: string
          statement_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_facts_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_records: {
        Row: {
          created_at: string
          fetched_at: string
          head_teacher: string | null
          la_code: string | null
          la_name: string | null
          name: string
          phase: string | null
          postcode: string | null
          postcode_district: string | null
          raw: Json | null
          resolved_urn: string | null
          source: string
          status: string
          trust_name: string | null
          trust_uid: string | null
          updated_at: string
          urn: string
          website: string | null
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          head_teacher?: string | null
          la_code?: string | null
          la_name?: string | null
          name: string
          phase?: string | null
          postcode?: string | null
          postcode_district?: string | null
          raw?: Json | null
          resolved_urn?: string | null
          source?: string
          status?: string
          trust_name?: string | null
          trust_uid?: string | null
          updated_at?: string
          urn: string
          website?: string | null
        }
        Update: {
          created_at?: string
          fetched_at?: string
          head_teacher?: string | null
          la_code?: string | null
          la_name?: string | null
          name?: string
          phase?: string | null
          postcode?: string | null
          postcode_district?: string | null
          raw?: Json | null
          resolved_urn?: string | null
          source?: string
          status?: string
          trust_name?: string | null
          trust_uid?: string | null
          updated_at?: string
          urn?: string
          website?: string | null
        }
        Relationships: []
      }
      company_refresh_runs: {
        Row: {
          degraded: boolean
          error: string | null
          finished_at: string | null
          id: string
          notes: Json | null
          company_search_id: string | null
          sources_ok: string[]
          sources_tried: string[]
          started_at: string
          vacancies_found: number
        }
        Insert: {
          degraded?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          company_search_id?: string | null
          sources_ok?: string[]
          sources_tried?: string[]
          started_at?: string
          vacancies_found?: number
        }
        Update: {
          degraded?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          company_search_id?: string | null
          sources_ok?: string[]
          sources_tried?: string[]
          started_at?: string
          vacancies_found?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_refresh_runs_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_scores: {
        Row: {
          breakdown: Json
          computed_at: string
          company_search_id: string
          score: number
          signals_computed_at: string | null
          top_code: string | null
          top_reason: string | null
        }
        Insert: {
          breakdown?: Json
          computed_at?: string
          company_search_id: string
          score: number
          signals_computed_at?: string | null
          top_code?: string | null
          top_reason?: string | null
        }
        Update: {
          breakdown?: Json
          computed_at?: string
          company_search_id?: string
          score?: number
          signals_computed_at?: string | null
          top_code?: string | null
          top_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_scores_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: true
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_scores_backup_20260910: {
        Row: {
          breakdown: Json | null
          computed_at: string | null
          company_search_id: string | null
          score: number | null
          signals_computed_at: string | null
          top_code: string | null
          top_reason: string | null
        }
        Insert: {
          breakdown?: Json | null
          computed_at?: string | null
          company_search_id?: string | null
          score?: number | null
          signals_computed_at?: string | null
          top_code?: string | null
          top_reason?: string | null
        }
        Update: {
          breakdown?: Json | null
          computed_at?: string | null
          company_search_id?: string | null
          score?: number | null
          signals_computed_at?: string | null
          top_code?: string | null
          top_reason?: string | null
        }
        Relationships: []
      }
      company_searches: {
        Row: {
          analysis_result: Json
          created_at: string
          evidence_computed_at: string | null
          evidence_fingerprint: string | null
          external_refs: Json
          id: string
          company_name: string
          updated_at: string
          url: string
          urn: string | null
        }
        Insert: {
          analysis_result: Json
          created_at?: string
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          external_refs?: Json
          id?: string
          company_name: string
          updated_at?: string
          url: string
          urn?: string | null
        }
        Update: {
          analysis_result?: Json
          created_at?: string
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          external_refs?: Json
          id?: string
          company_name?: string
          updated_at?: string
          url?: string
          urn?: string | null
        }
        Relationships: []
      }
      company_searches_backup_20260908: {
        Row: {
          analysis_result: Json | null
          created_at: string | null
          id: string | null
          company_name: string | null
          updated_at: string | null
          url: string | null
          urn: string | null
        }
        Insert: {
          analysis_result?: Json | null
          created_at?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Update: {
          analysis_result?: Json | null
          created_at?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Relationships: []
      }
      company_searches_backup_20260908b: {
        Row: {
          analysis_result: Json | null
          created_at: string | null
          id: string | null
          company_name: string | null
          updated_at: string | null
          url: string | null
          urn: string | null
        }
        Insert: {
          analysis_result?: Json | null
          created_at?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Update: {
          analysis_result?: Json | null
          created_at?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Relationships: []
      }
      company_searches_backup_20260909: {
        Row: {
          analysis_result: Json | null
          created_at: string | null
          evidence_computed_at: string | null
          evidence_fingerprint: string | null
          id: string | null
          company_name: string | null
          updated_at: string | null
          url: string | null
          urn: string | null
        }
        Insert: {
          analysis_result?: Json | null
          created_at?: string | null
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Update: {
          analysis_result?: Json | null
          created_at?: string | null
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Relationships: []
      }
      company_searches_backup_20260909_urn: {
        Row: {
          analysis_result: Json | null
          created_at: string | null
          evidence_computed_at: string | null
          evidence_fingerprint: string | null
          id: string | null
          company_name: string | null
          updated_at: string | null
          url: string | null
          urn: string | null
        }
        Insert: {
          analysis_result?: Json | null
          created_at?: string | null
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Update: {
          analysis_result?: Json | null
          created_at?: string | null
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Relationships: []
      }
      company_searches_backup_20260910: {
        Row: {
          analysis_result: Json | null
          created_at: string | null
          evidence_computed_at: string | null
          evidence_fingerprint: string | null
          external_refs: Json | null
          id: string | null
          company_name: string | null
          updated_at: string | null
          url: string | null
          urn: string | null
        }
        Insert: {
          analysis_result?: Json | null
          created_at?: string | null
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          external_refs?: Json | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Update: {
          analysis_result?: Json | null
          created_at?: string | null
          evidence_computed_at?: string | null
          evidence_fingerprint?: string | null
          external_refs?: Json | null
          id?: string | null
          company_name?: string | null
          updated_at?: string | null
          url?: string | null
          urn?: string | null
        }
        Relationships: []
      }
      company_signals: {
        Row: {
          code: string
          computed_at: string
          evidence: Json
          explanation: string
          id: string
          label: string
          company_search_id: string
          strength: number
        }
        Insert: {
          code: string
          computed_at?: string
          evidence?: Json
          explanation: string
          id?: string
          label: string
          company_search_id: string
          strength: number
        }
        Update: {
          code?: string
          computed_at?: string
          evidence?: Json
          explanation?: string
          id?: string
          label?: string
          company_search_id?: string
          strength?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_signals_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_signals_backup_20260910: {
        Row: {
          code: string | null
          computed_at: string | null
          evidence: Json | null
          explanation: string | null
          id: string | null
          label: string | null
          company_search_id: string | null
          strength: number | null
        }
        Insert: {
          code?: string | null
          computed_at?: string | null
          evidence?: Json | null
          explanation?: string | null
          id?: string | null
          label?: string | null
          company_search_id?: string | null
          strength?: number | null
        }
        Update: {
          code?: string | null
          computed_at?: string | null
          evidence?: Json | null
          explanation?: string | null
          id?: string | null
          label?: string | null
          company_search_id?: string | null
          strength?: number | null
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
      teaching_vacancies_live: {
        Row: {
          active: boolean
          date_posted: string | null
          employer_identifier: string | null
          employer_name: string | null
          employer_website: string | null
          employment_type: string[] | null
          first_seen: string
          last_seen: string
          locality: string | null
          occupational_category: string | null
          postcode: string | null
          postcode_district: string | null
          raw: Json | null
          region: string | null
          salary: string | null
          title: string
          url: string
          valid_through: string | null
        }
        Insert: {
          active?: boolean
          date_posted?: string | null
          employer_identifier?: string | null
          employer_name?: string | null
          employer_website?: string | null
          employment_type?: string[] | null
          first_seen?: string
          last_seen?: string
          locality?: string | null
          occupational_category?: string | null
          postcode?: string | null
          postcode_district?: string | null
          raw?: Json | null
          region?: string | null
          salary?: string | null
          title: string
          url: string
          valid_through?: string | null
        }
        Update: {
          active?: boolean
          date_posted?: string | null
          employer_identifier?: string | null
          employer_name?: string | null
          employer_website?: string | null
          employment_type?: string[] | null
          first_seen?: string
          last_seen?: string
          locality?: string | null
          occupational_category?: string | null
          postcode?: string | null
          postcode_district?: string | null
          raw?: Json | null
          region?: string | null
          salary?: string | null
          title?: string
          url?: string
          valid_through?: string | null
        }
        Relationships: []
      }
      pupil_premium_estimates: {
        Row: {
          academic_year: string | null
          allocation: number | null
          basis: string | null
          computed_at: string
          confidence: string
          day_rate: number | null
          document_url: string | null
          company_days: number | null
          company_search_id: string
          staffing_spend: number | null
          tas_per_week: number | null
          working: Json
        }
        Insert: {
          academic_year?: string | null
          allocation?: number | null
          basis?: string | null
          computed_at?: string
          confidence?: string
          day_rate?: number | null
          document_url?: string | null
          company_days?: number | null
          company_search_id: string
          staffing_spend?: number | null
          tas_per_week?: number | null
          working?: Json
        }
        Update: {
          academic_year?: string | null
          allocation?: number | null
          basis?: string | null
          computed_at?: string
          confidence?: string
          day_rate?: number | null
          document_url?: string | null
          company_days?: number | null
          company_search_id?: string
          staffing_spend?: number | null
          tas_per_week?: number | null
          working?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pupil_premium_estimates_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: true
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_documents: {
        Row: {
          academic_year: string | null
          checked_at: string
          created_at: string
          discovery: Json | null
          extract_error: string | null
          extracted: Json | null
          fetched_at: string | null
          id: string
          kind: string
          kind_of_file: string | null
          pages: number | null
          company_search_id: string
          sha256: string | null
          text: string | null
          text_chars: number | null
          updated_at: string
          url: string
        }
        Insert: {
          academic_year?: string | null
          checked_at?: string
          created_at?: string
          discovery?: Json | null
          extract_error?: string | null
          extracted?: Json | null
          fetched_at?: string | null
          id?: string
          kind: string
          kind_of_file?: string | null
          pages?: number | null
          company_search_id: string
          sha256?: string | null
          text?: string | null
          text_chars?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          academic_year?: string | null
          checked_at?: string
          created_at?: string
          discovery?: Json | null
          extract_error?: string | null
          extracted?: Json | null
          fetched_at?: string | null
          id?: string
          kind?: string
          kind_of_file?: string | null
          pages?: number | null
          company_search_id?: string
          sha256?: string | null
          text?: string | null
          text_chars?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_documents_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_notices: {
        Row: {
          awarded_supplier: string | null
          buyer_company_number: string | null
          buyer_name: string | null
          buyer_postcode: string | null
          contract_end: string | null
          cpv: string[]
          created_at: string
          deadline: string | null
          description: string | null
          first_seen: string
          id: string
          last_seen: string
          match_reason: string | null
          matched_la: string | null
          matched_company_search_id: string | null
          matched_trust_uid: string | null
          ocid: string
          published_at: string | null
          raw: Json | null
          regions: string[]
          release_id: string | null
          relevance: string | null
          scope: string | null
          source: string
          stage: string
          status: string | null
          title: string
          updated_at: string
          url: string
          value_amount: number | null
        }
        Insert: {
          awarded_supplier?: string | null
          buyer_company_number?: string | null
          buyer_name?: string | null
          buyer_postcode?: string | null
          contract_end?: string | null
          cpv?: string[]
          created_at?: string
          deadline?: string | null
          description?: string | null
          first_seen?: string
          id?: string
          last_seen?: string
          match_reason?: string | null
          matched_la?: string | null
          matched_company_search_id?: string | null
          matched_trust_uid?: string | null
          ocid: string
          published_at?: string | null
          raw?: Json | null
          regions?: string[]
          release_id?: string | null
          relevance?: string | null
          scope?: string | null
          source: string
          stage: string
          status?: string | null
          title: string
          updated_at?: string
          url: string
          value_amount?: number | null
        }
        Update: {
          awarded_supplier?: string | null
          buyer_company_number?: string | null
          buyer_name?: string | null
          buyer_postcode?: string | null
          contract_end?: string | null
          cpv?: string[]
          created_at?: string
          deadline?: string | null
          description?: string | null
          first_seen?: string
          id?: string
          last_seen?: string
          match_reason?: string | null
          matched_la?: string | null
          matched_company_search_id?: string | null
          matched_trust_uid?: string | null
          ocid?: string
          published_at?: string | null
          raw?: Json | null
          regions?: string[]
          release_id?: string | null
          relevance?: string | null
          scope?: string | null
          source?: string
          stage?: string
          status?: string | null
          title?: string
          updated_at?: string
          url?: string
          value_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_notices_matched_company_search_id_fkey"
            columns: ["matched_company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_board_listings: {
        Row: {
          active: boolean
          alerted_at: string | null
          board_id: string
          closing_date: string | null
          contract: string | null
          created_at: string
          first_seen: string
          id: string
          in_region: boolean
          last_seen: string
          listing_key: string
          location: string | null
          match_reason: string | null
          postcode: string | null
          raw: Json | null
          salary_text: string | null
          company_name: string | null
          company_search_id: string | null
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          alerted_at?: string | null
          board_id: string
          closing_date?: string | null
          contract?: string | null
          created_at?: string
          first_seen?: string
          id?: string
          in_region?: boolean
          last_seen?: string
          listing_key: string
          location?: string | null
          match_reason?: string | null
          postcode?: string | null
          raw?: Json | null
          salary_text?: string | null
          company_name?: string | null
          company_search_id?: string | null
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          alerted_at?: string | null
          board_id?: string
          closing_date?: string | null
          contract?: string | null
          created_at?: string
          first_seen?: string
          id?: string
          in_region?: boolean
          last_seen?: string
          listing_key?: string
          location?: string | null
          match_reason?: string | null
          postcode?: string | null
          raw?: Json | null
          salary_text?: string | null
          company_name?: string | null
          company_search_id?: string | null
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_board_listings_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "trust_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_board_listings_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_boards: {
        Row: {
          active: boolean
          consultant_id: string | null
          created_at: string
          id: string
          kind: string
          last_fetched_at: string | null
          last_status: string | null
          name: string
          notes: string | null
          region_filter: Json | null
          trust_uid: string | null
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          consultant_id?: string | null
          created_at?: string
          id?: string
          kind: string
          last_fetched_at?: string | null
          last_status?: string | null
          name: string
          notes?: string | null
          region_filter?: Json | null
          trust_uid?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          consultant_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_fetched_at?: string | null
          last_status?: string | null
          name?: string
          notes?: string | null
          region_filter?: Json | null
          trust_uid?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_boards_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_finances: {
        Row: {
          agency_supply_teaching_staff: number | null
          company_number: string
          created_at: string
          education_support_staff: number | null
          fetched_at: string
          fiscal_year: string
          in_year_balance: number | null
          other_staff_costs: number | null
          revenue_reserve: number | null
          source: string
          supply_teaching_staff: number | null
          total_expenditure: number | null
          updated_at: string
          year_end: number
        }
        Insert: {
          agency_supply_teaching_staff?: number | null
          company_number: string
          created_at?: string
          education_support_staff?: number | null
          fetched_at?: string
          fiscal_year: string
          in_year_balance?: number | null
          other_staff_costs?: number | null
          revenue_reserve?: number | null
          source?: string
          supply_teaching_staff?: number | null
          total_expenditure?: number | null
          updated_at?: string
          year_end: number
        }
        Update: {
          agency_supply_teaching_staff?: number | null
          company_number?: string
          created_at?: string
          education_support_staff?: number | null
          fetched_at?: string
          fiscal_year?: string
          in_year_balance?: number | null
          other_staff_costs?: number | null
          revenue_reserve?: number | null
          source?: string
          supply_teaching_staff?: number | null
          total_expenditure?: number | null
          updated_at?: string
          year_end?: number
        }
        Relationships: []
      }
      trusts: {
        Row: {
          academies_in_patch: number
          company_number: string | null
          created_at: string
          extract_date: string | null
          members_in_patch: number
          members_total: number
          name: string
          tracked: number
          trust_uid: string
          updated_at: string
        }
        Insert: {
          academies_in_patch?: number
          company_number?: string | null
          created_at?: string
          extract_date?: string | null
          members_in_patch?: number
          members_total?: number
          name: string
          tracked?: number
          trust_uid: string
          updated_at?: string
        }
        Update: {
          academies_in_patch?: number
          company_number?: string | null
          created_at?: string
          extract_date?: string | null
          members_in_patch?: number
          members_total?: number
          name?: string
          tracked?: number
          trust_uid?: string
          updated_at?: string
        }
        Relationships: []
      }
      bh_candidates: {
        Row: {
          availability_date: string | null
          availability_text: string | null
          bh_id: number
          bh_status: string | null
          compliance_state: string
          created_at: string
          date_added: string | null
          date_last_modified: string | null
          do_not_contact: boolean
          email: string | null
          email_status: string
          first_name: string | null
          id: string
          last_contact_at: string | null
          last_name: string | null
          last_placement_at: string | null
          last_placement_client: string | null
          last_placement_lat: number | null
          last_placement_lon: number | null
          last_placement_postcode: string | null
          lat: number | null
          lon: number | null
          mobile: string | null
          name: string
          sectors: string[]
          send_specialisms: string[]
          phone: string | null
          postcode: string | null
          area: string | null
          location_source: string | null
          files_listed_at: string | null
          raw: Json
          roles: string[]
          skills: string[]
          synced_at: string
          updated_at: string
        }
        Insert: {
          availability_date?: string | null
          availability_text?: string | null
          bh_id: number
          bh_status?: string | null
          compliance_state?: string
          created_at?: string
          date_added?: string | null
          date_last_modified?: string | null
          do_not_contact?: boolean
          email?: string | null
          email_status?: string
          first_name?: string | null
          id?: string
          last_contact_at?: string | null
          last_name?: string | null
          last_placement_at?: string | null
          last_placement_client?: string | null
          last_placement_lat?: number | null
          last_placement_lon?: number | null
          last_placement_postcode?: string | null
          lat?: number | null
          lon?: number | null
          mobile?: string | null
          name: string
          sectors?: string[]
          send_specialisms?: string[]
          phone?: string | null
          postcode?: string | null
          area?: string | null
          location_source?: string | null
          files_listed_at?: string | null
          raw?: Json
          roles?: string[]
          skills?: string[]
          synced_at?: string
          updated_at?: string
        }
        Update: {
          availability_date?: string | null
          availability_text?: string | null
          bh_id?: number
          bh_status?: string | null
          compliance_state?: string
          created_at?: string
          date_added?: string | null
          date_last_modified?: string | null
          do_not_contact?: boolean
          email?: string | null
          email_status?: string
          first_name?: string | null
          id?: string
          last_contact_at?: string | null
          last_name?: string | null
          last_placement_at?: string | null
          last_placement_client?: string | null
          last_placement_lat?: number | null
          last_placement_lon?: number | null
          last_placement_postcode?: string | null
          lat?: number | null
          lon?: number | null
          mobile?: string | null
          name?: string
          sectors?: string[]
          send_specialisms?: string[]
          phone?: string | null
          postcode?: string | null
          area?: string | null
          location_source?: string | null
          files_listed_at?: string | null
          raw?: Json
          roles?: string[]
          skills?: string[]
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      bh_candidate_files: {
        Row: {
          bh_file_id: number
          candidate_id: string
          content_subtype: string | null
          created_at: string
          date_added: string | null
          extract_error: string | null
          extracted_at: string | null
          id: string
          is_cv: boolean
          name: string | null
          size_bytes: number | null
          text: string | null
          text_chars: number | null
          type: string | null
        }
        Insert: {
          bh_file_id: number
          candidate_id: string
          content_subtype?: string | null
          created_at?: string
          date_added?: string | null
          extract_error?: string | null
          extracted_at?: string | null
          id?: string
          is_cv?: boolean
          name?: string | null
          size_bytes?: number | null
          text?: string | null
          text_chars?: number | null
          type?: string | null
        }
        Update: {
          bh_file_id?: number
          candidate_id?: string
          content_subtype?: string | null
          created_at?: string
          date_added?: string | null
          extract_error?: string | null
          extracted_at?: string | null
          id?: string
          is_cv?: boolean
          name?: string | null
          size_bytes?: number | null
          text?: string | null
          text_chars?: number | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bh_candidate_files_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "bh_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      bh_cv_queue: {
        Row: {
          dispatched_at: string | null
          enqueued_at: string
          error: string | null
          file_id: string
          id: number
          request_id: number | null
        }
        Insert: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          file_id: string
          id?: number
          request_id?: number | null
        }
        Update: {
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          file_id?: string
          id?: number
          request_id?: number | null
        }
        Relationships: []
      }
      shortlist_criteria: {
        Row: {
          description: string
          group_name: string
          key: string
          label: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description: string
          group_name: string
          key: string
          label: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string
          group_name?: string
          key?: string
          label?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      shortlists: {
        Row: {
          considered: number
          consultant_id: string | null
          created_at: string
          created_by: string | null
          criteria: Json
          id: string
          notes: Json
          pool_size: number
          rerank_model: string | null
          company: Json
          company_search_id: string | null
          status: string
          updated_at: string
          vacancy: Json
          vacancy_id: string | null
        }
        Insert: {
          considered?: number
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          notes?: Json
          pool_size?: number
          rerank_model?: string | null
          company?: Json
          company_search_id: string | null
          status?: string
          updated_at?: string
          vacancy?: Json
          vacancy_id?: string | null
        }
        Update: {
          considered?: number
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          notes?: Json
          pool_size?: number
          rerank_model?: string | null
          company?: Json
          company_search_id?: string | null
          status?: string
          updated_at?: string
          vacancy?: Json
          vacancy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shortlists_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shortlists_company_search_id_fkey"
            columns: ["company_search_id"]
            isOneToOne: false
            referencedRelation: "company_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shortlists_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlist_candidates: {
        Row: {
          candidate_id: string
          created_at: string
          cv_excerpt: string | null
          decided_at: string | null
          decided_by: string | null
          decision: string
          match: boolean
          id: string
          parts: Json
          rank: number
          reasons: Json
          score: number
          shortlist_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          cv_excerpt?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          match?: boolean
          id?: string
          parts?: Json
          rank: number
          reasons?: Json
          score: number
          shortlist_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          cv_excerpt?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          match?: boolean
          id?: string
          parts?: Json
          rank?: number
          reasons?: Json
          score?: number
          shortlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_candidates_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "bh_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shortlist_candidates_shortlist_id_fkey"
            columns: ["shortlist_id"]
            isOneToOne: false
            referencedRelation: "shortlists"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlist_emails: {
        Row: {
          bh_note_error: string | null
          bh_note_id: number | null
          body: string
          bounced_at: string | null
          created_at: string
          dry_run: boolean | null
          id: string
          message_id: string | null
          model: string | null
          quality_flags: string[]
          queued_at: string | null
          reply_to: string | null
          sent_at: string | null
          shortlist_candidate_id: string
          status: string
          subject: string
          to_email: string | null
          updated_at: string
        }
        Insert: {
          bh_note_error?: string | null
          bh_note_id?: number | null
          body: string
          bounced_at?: string | null
          created_at?: string
          dry_run?: boolean | null
          id?: string
          message_id?: string | null
          model?: string | null
          quality_flags?: string[]
          queued_at?: string | null
          reply_to?: string | null
          sent_at?: string | null
          shortlist_candidate_id: string
          status?: string
          subject: string
          to_email?: string | null
          updated_at?: string
        }
        Update: {
          bh_note_error?: string | null
          bh_note_id?: number | null
          body?: string
          bounced_at?: string | null
          created_at?: string
          dry_run?: boolean | null
          id?: string
          message_id?: string | null
          model?: string | null
          quality_flags?: string[]
          queued_at?: string | null
          reply_to?: string | null
          sent_at?: string | null
          shortlist_candidate_id?: string
          status?: string
          subject?: string
          to_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_emails_shortlist_candidate_id_fkey"
            columns: ["shortlist_candidate_id"]
            isOneToOne: true
            referencedRelation: "shortlist_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancies: {
        Row: {
          closing_date: string | null
          created_at: string
          employer_name: string | null
          external_refs: Json
          first_seen: string
          id: string
          last_seen: string
          raw: Json | null
          rejected_reason: string | null
          company_search_id: string | null
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
          created_at?: string
          employer_name?: string | null
          external_refs?: Json
          first_seen?: string
          id?: string
          last_seen?: string
          raw?: Json | null
          rejected_reason?: string | null
          company_search_id: string | null
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
          created_at?: string
          employer_name?: string | null
          external_refs?: Json
          first_seen?: string
          id?: string
          last_seen?: string
          raw?: Json | null
          rejected_reason?: string | null
          company_search_id?: string | null
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
            isOneToOne: false
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
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancy_snapshots: {
        Row: {
          alert_settings_id: string
          created_at: string
          id: string
          company_id: string
          company_name: string
          urn: string | null
          vacancies: Json
        }
        Insert: {
          alert_settings_id: string
          created_at?: string
          id?: string
          company_id: string
          company_name: string
          urn?: string | null
          vacancies?: Json
        }
        Update: {
          alert_settings_id?: string
          created_at?: string
          id?: string
          company_id?: string
          company_name?: string
          urn?: string | null
          vacancies?: Json
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_snapshots_alert_settings_id_fkey"
            columns: ["alert_settings_id"]
            isOneToOne: false
            referencedRelation: "vacancy_alert_settings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_role: { Args: never; Returns: string }
      has_feature: { Args: { p_feature: string }; Returns: boolean }
      my_consultant_ids: { Args: never; Returns: string[] }
      can_see_company_shortlists: { Args: { p_company: string }; Returns: boolean }
      can_see_shortlist: { Args: { p_shortlist: string }; Returns: boolean }
      auth_before_user_created: { Args: { event: Json }; Returns: Json }
      board_fetch_slot: {
        Args: { p_board: string; p_min_seconds: number }
        Returns: boolean
      }
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
          p_force?: boolean
          p_nightly_cap?: number
          p_personas: string[]
          p_company_id: string
          p_trigger?: string
        }
        Returns: string
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_agency_spend_peers: {
        Args: {
          p_fiscal_year?: string
          p_la_name: string
          p_phase: string
          p_urn: string
        }
        Returns: Json
      }
      get_ai_usage_summary: { Args: never; Returns: Json }
      get_cron_last_run: { Args: { p_jobid: number }; Returns: Json }
      get_cron_monitoring_jobs_only: { Args: never; Returns: Json }
      get_cron_monitoring_status: { Args: never; Returns: Json }
      get_cron_recent_runs: {
        Args: { p_jobid: number; p_limit?: number }
        Returns: Json
      }
      get_pipeline_health: { Args: never; Returns: Json }
      get_pupil_premium_peers: {
        Args: { p_la_name: string; p_company_search_id: string }
        Returns: {
          count: number
          la_name: string
          median: number
        }[]
      }
      get_spend_peer_series: {
        Args: { p_la_name: string; p_phase: string; p_urn: string }
        Returns: Json
      }
      get_vacancy_email_counters: { Args: never; Returns: Json }
      invoke_edge_function: {
        Args: { function_name: string; payload?: Json }
        Returns: number
      }
      is_allowed_login_email: { Args: { p_email: string }; Returns: boolean }
      is_app_user: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalise_phase: { Args: { p: string }; Returns: string }
      owns_alert_setting: {
        Args: { p_consultant_id: string; p_email: string }
        Returns: boolean
      }
      process_email_queue_tick: { Args: never; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      set_company_copy: {
        Args: {
          p_cold_call?: string
          p_copy: Json
          p_persona: string
          p_company_id: string
          p_warm_email?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      vacancy_source:
        | "teaching_vacancies"
        | "tes"
        | "company_website"
        | "llm"
        | "other"
        | "mynewterm"
        | "eteach"
        | "guardian_jobs"
        | "jobs_go_public"
        | "consultant"
        | "trust_board"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      vacancy_source: [
        "teaching_vacancies",
        "tes",
        "company_website",
        "llm",
        "other",
        "mynewterm",
        "eteach",
        "guardian_jobs",
        "jobs_go_public",
        "consultant",
        "trust_board",
      ],
    },
  },
} as const
