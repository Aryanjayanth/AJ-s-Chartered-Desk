export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          created_at: string;
          firm_id: string | null;
          id: number;
          module: string;
          new_value: Json | null;
          old_value: Json | null;
          reason: string | null;
          record_id: string | null;
          user_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          firm_id?: string | null;
          id?: never;
          module: string;
          new_value?: Json | null;
          old_value?: Json | null;
          reason?: string | null;
          record_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          firm_id?: string | null;
          id?: never;
          module?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          reason?: string | null;
          record_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_transactions: {
        Row: {
          amount: number;
          created_at: string;
          description: string | null;
          direction: string;
          firm_id: string;
          id: string;
          import_batch: string | null;
          imported_by: string | null;
          matched_payment_id: string | null;
          reference: string | null;
          status: string;
          txn_date: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          description?: string | null;
          direction?: string;
          firm_id?: string;
          id?: string;
          import_batch?: string | null;
          imported_by?: string | null;
          matched_payment_id?: string | null;
          reference?: string | null;
          status?: string;
          txn_date: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          description?: string | null;
          direction?: string;
          firm_id?: string;
          id?: string;
          import_batch?: string | null;
          imported_by?: string | null;
          matched_payment_id?: string | null;
          reference?: string | null;
          status?: string;
          txn_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_transactions_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_transactions_matched_payment_id_fkey";
            columns: ["matched_payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      client_services: {
        Row: {
          agreed_fee: number;
          assigned_staff: string | null;
          auto_invoice: boolean;
          client_id: string;
          created_at: string;
          due_days: number;
          end_date: string | null;
          firm_id: string;
          frequency: string;
          id: string;
          notes: string | null;
          service_id: string;
          start_date: string;
          status: string;
        };
        Insert: {
          agreed_fee: number;
          assigned_staff?: string | null;
          auto_invoice?: boolean;
          client_id: string;
          created_at?: string;
          due_days?: number;
          end_date?: string | null;
          firm_id?: string;
          frequency: string;
          id?: string;
          notes?: string | null;
          service_id: string;
          start_date?: string;
          status?: string;
        };
        Update: {
          agreed_fee?: number;
          assigned_staff?: string | null;
          auto_invoice?: boolean;
          client_id?: string;
          created_at?: string;
          due_days?: number;
          end_date?: string | null;
          firm_id?: string;
          frequency?: string;
          id?: string;
          notes?: string | null;
          service_id?: string;
          start_date?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_services_assigned_staff_fkey";
            columns: ["assigned_staff"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_services_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_services_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_services_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          address: string;
          assigned_staff: string | null;
          avatar_url: string | null;
          business_type: string | null;
          client_code: string;
          client_type: string;
          contact_person_name: string | null;
          contact_person_phone: string | null;
          contact_person_role: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          firm_id: string;
          gst_type: string | null;
          gstin: string | null;
          id: string;
          industry: string | null;
          is_demo: boolean;
          mobile: string;
          name: string;
          notes: string | null;
          pan: string | null;
          secondary_phone: string | null;
          status: string;
          tan: string | null;
          updated_at: string;
        };
        Insert: {
          address: string;
          assigned_staff?: string | null;
          avatar_url?: string | null;
          business_type?: string | null;
          client_code?: string;
          client_type?: string;
          contact_person_name?: string | null;
          contact_person_phone?: string | null;
          contact_person_role?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          firm_id?: string;
          gst_type?: string | null;
          gstin?: string | null;
          id?: string;
          industry?: string | null;
          is_demo?: boolean;
          mobile: string;
          name: string;
          notes?: string | null;
          pan?: string | null;
          secondary_phone?: string | null;
          status?: string;
          tan?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string;
          assigned_staff?: string | null;
          avatar_url?: string | null;
          business_type?: string | null;
          client_code?: string;
          client_type?: string;
          contact_person_name?: string | null;
          contact_person_phone?: string | null;
          contact_person_role?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          firm_id?: string;
          gst_type?: string | null;
          gstin?: string | null;
          id?: string;
          industry?: string | null;
          is_demo?: boolean;
          mobile?: string;
          name?: string;
          notes?: string | null;
          pan?: string | null;
          secondary_phone?: string | null;
          status?: string;
          tan?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_assigned_staff_fkey";
            columns: ["assigned_staff"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      discounts: {
        Row: {
          approved_by: string | null;
          created_at: string;
          discount_amount: number;
          firm_id: string;
          id: string;
          invoice_id: string | null;
          job_id: string | null;
          net_amount: number;
          original_amount: number;
          reason: string | null;
        };
        Insert: {
          approved_by?: string | null;
          created_at?: string;
          discount_amount: number;
          firm_id?: string;
          id?: string;
          invoice_id?: string | null;
          job_id?: string | null;
          net_amount: number;
          original_amount: number;
          reason?: string | null;
        };
        Update: {
          approved_by?: string | null;
          created_at?: string;
          discount_amount?: number;
          firm_id?: string;
          id?: string;
          invoice_id?: string | null;
          job_id?: string | null;
          net_amount?: number;
          original_amount?: number;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "discounts_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "discounts_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "discounts_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      firm_invites: {
        Row: {
          accepted: boolean;
          created_at: string;
          email: string;
          firm_id: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
        };
        Insert: {
          accepted?: boolean;
          created_at?: string;
          email: string;
          firm_id: string;
          full_name?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
        };
        Update: {
          accepted?: boolean;
          created_at?: string;
          email?: string;
          firm_id?: string;
          full_name?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
        };
        Relationships: [
          {
            foreignKeyName: "firm_invites_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      firms: {
        Row: {
          city: string | null;
          created_at: string;
          id: string;
          logo_url: string | null;
          name: string;
          owner_email: string | null;
          phone: string | null;
          status: string;
        };
        Insert: {
          city?: string | null;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name: string;
          owner_email?: string | null;
          phone?: string | null;
          status?: string;
        };
        Update: {
          city?: string | null;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name?: string;
          owner_email?: string | null;
          phone?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      invoice_items: {
        Row: {
          amount: number;
          description: string;
          firm_id: string;
          id: string;
          invoice_id: string;
          job_id: string | null;
        };
        Insert: {
          amount: number;
          description: string;
          firm_id?: string;
          id?: string;
          invoice_id: string;
          job_id?: string | null;
        };
        Update: {
          amount?: number;
          description?: string;
          firm_id?: string;
          id?: string;
          invoice_id?: string;
          job_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_items_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          amount_paid: number;
          cancel_reason: string | null;
          client_id: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          discount: number;
          due_date: string;
          firm_id: string;
          id: string;
          invoice_date: string;
          invoice_no: string;
          is_demo: boolean;
          job_id: string | null;
          notes: string | null;
          outstanding: number | null;
          payment_id: string | null;
          status: string;
          subtotal: number;
          tax_amount: number;
          tax_rate: number;
          total: number;
        };
        Insert: {
          amount_paid?: number;
          cancel_reason?: string | null;
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount?: number;
          due_date?: string;
          firm_id?: string;
          id?: string;
          invoice_date?: string;
          invoice_no?: string;
          is_demo?: boolean;
          job_id?: string | null;
          notes?: string | null;
          outstanding?: number | null;
          payment_id?: string | null;
          status?: string;
          subtotal?: number;
          tax_amount?: number;
          tax_rate?: number;
          total?: number;
        };
        Update: {
          amount_paid?: number;
          cancel_reason?: string | null;
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount?: number;
          due_date?: string;
          firm_id?: string;
          id?: string;
          invoice_date?: string;
          invoice_no?: string;
          is_demo?: boolean;
          job_id?: string | null;
          notes?: string | null;
          outstanding?: number | null;
          payment_id?: string | null;
          status?: string;
          subtotal?: number;
          tax_amount?: number;
          tax_rate?: number;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          amount: number;
          category: string;
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          description: string;
          expense_date: string;
          firm_id: string;
          id: string;
          job_id: string | null;
          kind: "overhead" | "tax" | "reimbursement";
          mode: string;
          notes: string | null;
          paid_to: string | null;
          reference: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          category?: string;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description: string;
          expense_date?: string;
          firm_id?: string;
          id?: string;
          job_id?: string | null;
          kind?: "overhead" | "tax" | "reimbursement";
          mode?: string;
          notes?: string | null;
          paid_to?: string | null;
          reference?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category?: string;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          expense_date?: string;
          firm_id?: string;
          id?: string;
          job_id?: string | null;
          kind?: "overhead" | "tax" | "reimbursement";
          mode?: string;
          notes?: string | null;
          paid_to?: string | null;
          reference?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_clearing: {
        Row: {
          advance: number;
          cleared_at: string | null;
          cleared_by: string | null;
          created_at: string;
          discount: number;
          final_amount: number;
          firm_id: string;
          gross_fee: number;
          id: string;
          job_id: string;
          notes: string | null;
          other_addition: number;
          other_deduction: number;
          squared_off_at: string | null;
          squared_off_by: string | null;
          status: string;
          tds_tcs: number;
          updated_at: string;
        };
        Insert: {
          advance?: number;
          cleared_at?: string | null;
          cleared_by?: string | null;
          created_at?: string;
          discount?: number;
          final_amount?: number;
          firm_id?: string;
          gross_fee?: number;
          id?: string;
          job_id: string;
          notes?: string | null;
          other_addition?: number;
          other_deduction?: number;
          squared_off_at?: string | null;
          squared_off_by?: string | null;
          status?: string;
          tds_tcs?: number;
          updated_at?: string;
        };
        Update: {
          advance?: number;
          cleared_at?: string | null;
          cleared_by?: string | null;
          created_at?: string;
          discount?: number;
          final_amount?: number;
          firm_id?: string;
          gross_fee?: number;
          id?: string;
          job_id?: string;
          notes?: string | null;
          other_addition?: number;
          other_deduction?: number;
          squared_off_at?: string | null;
          squared_off_by?: string | null;
          status?: string;
          tds_tcs?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_clearing_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_clearing_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      job_conditions: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          enabled: boolean;
          firm_id: string;
          id: string;
          label: string;
          severity: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          firm_id?: string;
          id?: string;
          label: string;
          severity?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          firm_id?: string;
          id?: string;
          label?: string;
          severity?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_conditions_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      job_status_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          firm_id: string;
          id: string;
          job_id: string;
          new_status: string;
          old_status: string | null;
          reason: string | null;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          firm_id?: string;
          id?: string;
          job_id: string;
          new_status: string;
          old_status?: string | null;
          reason?: string | null;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          firm_id?: string;
          id?: string;
          job_id?: string;
          new_status?: string;
          old_status?: string | null;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_status_history_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_status_history_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          assigned_staff: string | null;
          auto_invoice: boolean;
          batch_id: string | null;
          checklist: Json;
          client_id: string;
          client_service_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          discount: number;
          due_date: string | null;
          fee: number;
          financial_status: string;
          firm_id: string;
          id: string;
          job_code: string;
          net_amount: number | null;
          notes: string | null;
          period_end: string | null;
          period_start: string | null;
          service_id: string;
          status: string;
          title: string;
        };
        Insert: {
          assigned_staff?: string | null;
          auto_invoice?: boolean;
          batch_id?: string | null;
          checklist?: Json;
          client_id: string;
          client_service_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          due_date?: string | null;
          fee?: number;
          financial_status?: string;
          firm_id?: string;
          id?: string;
          job_code?: string;
          net_amount?: number | null;
          notes?: string | null;
          period_end?: string | null;
          period_start?: string | null;
          service_id: string;
          status?: string;
          title: string;
        };
        Update: {
          assigned_staff?: string | null;
          auto_invoice?: boolean;
          batch_id?: string | null;
          checklist?: Json;
          client_id?: string;
          client_service_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          due_date?: string | null;
          fee?: number;
          financial_status?: string;
          firm_id?: string;
          id?: string;
          job_code?: string;
          net_amount?: number | null;
          notes?: string | null;
          period_end?: string | null;
          period_start?: string | null;
          service_id?: string;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_staff_fkey";
            columns: ["assigned_staff"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_client_service_id_fkey";
            columns: ["client_service_id"];
            isOneToOne: false;
            referencedRelation: "client_services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_allocations: {
        Row: {
          allocated_by: string | null;
          amount: number;
          created_at: string;
          firm_id: string;
          id: string;
          invoice_id: string;
          payment_id: string;
          reversed: boolean;
          reversed_at: string | null;
        };
        Insert: {
          allocated_by?: string | null;
          amount: number;
          created_at?: string;
          firm_id?: string;
          id?: string;
          invoice_id: string;
          payment_id: string;
          reversed?: boolean;
          reversed_at?: string | null;
        };
        Update: {
          allocated_by?: string | null;
          amount?: number;
          created_at?: string;
          firm_id?: string;
          id?: string;
          invoice_id?: string;
          payment_id?: string;
          reversed?: boolean;
          reversed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_allocations_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_reversals: {
        Row: {
          firm_id: string;
          id: string;
          payment_id: string;
          reason: string;
          reversal_ref: string;
          reversed_at: string;
          reversed_by: string | null;
        };
        Insert: {
          firm_id?: string;
          id?: string;
          payment_id: string;
          reason: string;
          reversal_ref?: string;
          reversed_at?: string;
          reversed_by?: string | null;
        };
        Update: {
          firm_id?: string;
          id?: string;
          payment_id?: string;
          reason?: string;
          reversal_ref?: string;
          reversed_at?: string;
          reversed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_reversals_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_reversals_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: true;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          allocated_amount: number;
          amount: number;
          client_id: string;
          created_at: string;
          created_by: string | null;
          firm_id: string;
          id: string;
          is_demo: boolean;
          job_id: string | null;
          mode: string;
          narration: string | null;
          payment_code: string;
          payment_date: string;
          reconciled: boolean;
          reference: string | null;
          status: string;
        };
        Insert: {
          allocated_amount?: number;
          amount: number;
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          firm_id?: string;
          id?: string;
          is_demo?: boolean;
          job_id?: string | null;
          mode: string;
          narration?: string | null;
          payment_code?: string;
          payment_date?: string;
          reconciled?: boolean;
          reference?: string | null;
          status?: string;
        };
        Update: {
          allocated_amount?: number;
          amount?: number;
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          firm_id?: string;
          id?: string;
          is_demo?: boolean;
          job_id?: string | null;
          mode?: string;
          narration?: string | null;
          payment_code?: string;
          payment_date?: string;
          reconciled?: boolean;
          reference?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          acting_firm_id: string | null;
          active: boolean;
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          firm_id: string | null;
          full_name: string | null;
          id: string;
        };
        Insert: {
          acting_firm_id?: string | null;
          active?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          firm_id?: string | null;
          full_name?: string | null;
          id: string;
        };
        Update: {
          acting_firm_id?: string | null;
          active?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          firm_id?: string | null;
          full_name?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_acting_firm_id_fkey";
            columns: ["acting_firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          active: boolean;
          auto_invoice: boolean;
          billing_type: string;
          created_at: string;
          description: string | null;
          firm_id: string;
          frequency: string;
          id: string;
          name: string;
          service_code: string;
          service_type: string;
        };
        Insert: {
          active?: boolean;
          auto_invoice?: boolean;
          billing_type: string;
          created_at?: string;
          description?: string | null;
          firm_id?: string;
          frequency: string;
          id?: string;
          name: string;
          service_code?: string;
          service_type: string;
        };
        Update: {
          active?: boolean;
          auto_invoice?: boolean;
          billing_type: string;
          created_at?: string;
          description?: string | null;
          firm_id?: string;
          frequency: string;
          id?: string;
          name?: string;
          service_code?: string;
          service_type: string;
        };
        Relationships: [
          {
            foreignKeyName: "services_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permissions: {
        Row: {
          can_amounts: boolean;
          can_create: boolean;
          can_delete: boolean;
          can_edit: boolean;
          can_view: boolean;
          firm_id: string;
          module: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          can_amounts?: boolean;
          can_create?: boolean;
          can_delete?: boolean;
          can_edit?: boolean;
          can_view?: boolean;
          firm_id?: string;
          module: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          can_amounts?: boolean;
          can_create?: boolean;
          can_delete?: boolean;
          can_edit?: boolean;
          can_view?: boolean;
          firm_id?: string;
          module?: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_payments: {
        Row: {
          amount: number;
          client_id: string;
          created_at: string;
          created_by: string | null;
          firm_id: string;
          frequency: string;
          id: string;
          job_id: string | null;
          label: string;
          last_run_at: string | null;
          mode: string;
          next_run_date: string;
          notes: string | null;
          reference: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          firm_id?: string;
          frequency: string;
          id?: string;
          job_id?: string | null;
          label: string;
          last_run_at?: string | null;
          mode?: string;
          next_run_date?: string;
          notes?: string | null;
          reference?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          firm_id?: string;
          frequency?: string;
          id?: string;
          job_id?: string | null;
          label?: string;
          last_run_at?: string | null;
          mode?: string;
          next_run_date?: string;
          notes?: string | null;
          reference?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_payments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_payments_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: false;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_payments_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          address: string | null;
          bank_details: string | null;
          default_tax_rate: number;
          email: string | null;
          firm_id: string;
          firm_name: string;
          gstin: string | null;
          id: number;
          invoice_terms: string | null;
          pan: string | null;
          phone: string | null;
        };
        Insert: {
          address?: string | null;
          bank_details?: string | null;
          default_tax_rate?: number;
          email?: string | null;
          firm_id?: string;
          firm_name?: string;
          gstin?: string | null;
          id?: number;
          invoice_terms?: string | null;
          pan?: string | null;
          phone?: string | null;
        };
        Update: {
          address?: string | null;
          bank_details?: string | null;
          default_tax_rate?: number;
          email?: string | null;
          firm_id?: string;
          firm_name?: string;
          gstin?: string | null;
          id?: number;
          invoice_terms?: string | null;
          pan?: string | null;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "settings_firm_id_fkey";
            columns: ["firm_id"];
            isOneToOne: true;
            referencedRelation: "firms";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      allocate_payment: {
        Args: { _allocations: Json; _payment_id: string };
        Returns: undefined;
      };
      cancel_invoice: {
        Args: { _invoice_id: string; _reason: string };
        Returns: undefined;
      };
      client_jobs_list: {
        Args: { _client_id: string };
        Returns: {
          id: string;
          job_code: string;
          client_id: string;
          service_id: string;
          service_name: string | null;
          title: string;
          period_start: string | null;
          period_end: string | null;
          fee: number | null;
          discount: number | null;
          net_amount: number | null;
          due_date: string | null;
          assigned_staff: string | null;
          assigned_staff_name: string | null;
          status: string;
          financial_status: string;
          notes: string | null;
          auto_invoice: boolean;
          created_at: string;
          invoice_id: string | null;
          invoice_no: string | null;
          invoice_status: string | null;
        }[];
      };
      client_lookup: {
        Args: never;
        Returns: {
          client_code: string;
          id: string;
          name: string;
        }[];
      };
      client_payments_list: {
        Args: { _client_id: string };
        Returns: {
          id: string;
          payment_code: string;
          client_id: string;
          job_id: string;
          amount: number | null;
          allocated_amount: number | null;
          mode: string;
          payment_date: string;
          reference: string | null;
          narration: string | null;
          status: string;
          created_at: string;
        }[];
      };
      client_services_list: {
        Args: { _client_id: string };
        Returns: {
          id: string;
          client_id: string;
          service_id: string;
          service_name: string | null;
          service_type: string | null;
          auto_invoice: boolean | null;
          agreed_fee: number | null;
          frequency: string;
          start_date: string;
          end_date: string | null;
          due_days: number;
          assigned_staff: string | null;
          assigned_staff_name: string | null;
          status: string;
          notes: string | null;
          created_at: string;
        }[];
      };
      create_firm: {
        Args: {
          _city: string;
          _logo_url: string;
          _name: string;
          _owner_email: string;
          _phone: string;
        };
        Returns: string;
      };
      create_invoice: {
        Args: {
          _client_id: string;
          _discount: number;
          _discount_reason: string;
          _due_date: string;
          _extra_amount: number;
          _extra_desc: string;
          _invoice_date: string;
          _job_ids: string[];
          _notes: string;
          _tax_rate: number;
        };
        Returns: string;
      };
      create_invoice_for_job: {
        Args: {
          _due_date: string;
          _extra_amount: number;
          _extra_desc: string;
          _invoice_date: string;
          _job_id: string;
          _notes: string;
          _payment_id: string | null;
          _tax_rate: number;
        };
        Returns: string;
      };
      job_workflow: { Args: { _job_id: string }; Returns: Json };
      mark_job_cleared: {
        Args: { _job_id: string; _notes: string };
        Returns: undefined;
      };
      reopen_job_clearing: {
        Args: { _job_id: string; _reason: string };
        Returns: undefined;
      };
      save_job_clearing: {
        Args: {
          _advance: number;
          _discount: number;
          _job_id: string;
          _notes: string;
          _other_addition: number;
          _other_deduction: number;
          _tds_tcs: number;
        };
        Returns: string;
      };
      sq_off_job_clearing: {
        Args: { _job_id: string; _notes: string };
        Returns: undefined;
      };
      delete_firm: { Args: { _firm_id: string }; Returns: undefined };
      current_firm_id: { Args: never; Returns: string };
      firm_guard: { Args: { _id: string; _tbl: string }; Returns: undefined };
      firm_overview: {
        Args: never;
        Returns: {
          city: string;
          clients: number;
          created_at: string;
          id: string;
          invoiced: number;
          logo_url: string;
          name: string;
          outstanding: number;
          owner_email: string;
          phone: string;
          status: string;
          users: number;
        }[];
      };
      generate_recurring_jobs: { Args: { _upto: string }; Returns: number };
      delete_expense: {
        Args: { _expense_id: string; _reason: string };
        Returns: undefined;
      };
      expenses_for_job: {
        Args: { _job_id: string };
        Returns: {
          id: string;
          kind: "overhead" | "tax" | "reimbursement";
          category: string;
          description: string;
          amount: number | null;
          mode: string;
          paid_to: string | null;
          reference: string | null;
          expense_date: string;
        }[];
      };
      expenses_list: {
        Args: never;
        Returns: {
          id: string;
          kind: "overhead" | "tax" | "reimbursement";
          expense_date: string;
          category: string;
          description: string;
          amount: number | null;
          mode: string;
          reference: string | null;
          paid_to: string | null;
          notes: string | null;
          client_id: string | null;
          client_name: string | null;
          job_id: string | null;
          job_code: string | null;
          created_at: string;
        }[];
      };
      jobs_list: {
        Args: never;
        Returns: {
          id: string;
          job_code: string;
          client_id: string;
          client_name: string | null;
          service_id: string;
          service_name: string | null;
          client_service_id: string | null;
          title: string;
          period_start: string | null;
          period_end: string | null;
          fee: number | null;
          discount: number | null;
          net_amount: number | null;
          due_date: string | null;
          assigned_staff: string | null;
          assigned_staff_name: string | null;
          status: string;
          financial_status: string;
          notes: string | null;
          auto_invoice: boolean;
          created_at: string;
          invoice_id: string | null;
          invoice_no: string | null;
          invoice_status: string | null;
        }[];
      };
      payments_list: {
        Args: never;
        Returns: {
          id: string;
          payment_code: string;
          client_id: string;
          job_id: string;
          amount: number | null;
          mode: string;
          payment_date: string;
          reference: string | null;
          narration: string | null;
          status: string;
          created_at: string;
        }[];
      };
      generate_recurring_jobs_all: { Args: never; Returns: number };
      generate_recurring_jobs_for_firm: {
        Args: { _firm: string; _upto: string };
        Returns: number;
      };
      has_capability: {
        Args: { _action: string; _module: string };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_cashier: { Args: never; Returns: boolean };
      is_finance: { Args: never; Returns: boolean };
      is_manager: { Args: never; Returns: boolean };
      is_staff_plus: { Args: never; Returns: boolean };
      is_super_admin: { Args: never; Returns: boolean };
      my_permissions: { Args: never; Returns: Json };
      my_roles: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"][];
      };
      permission_matrix: {
        Args: never;
        Returns: {
          role: Database["public"]["Enums"]["app_role"];
          module: string;
          can_view: boolean;
          can_create: boolean;
          can_edit: boolean;
          can_delete: boolean;
          can_amounts: boolean;
          editable: boolean;
        }[];
      };
      recalc_invoice: { Args: { _id: string }; Returns: undefined };
      recalc_payment: { Args: { _id: string }; Returns: undefined };
      recurring_list: {
        Args: never;
        Returns: {
          id: string;
          client_id: string;
          client_name: string | null;
          service_id: string;
          service_name: string | null;
          agreed_fee: number | null;
          frequency: string;
          start_date: string;
          end_date: string | null;
          due_days: number;
          assigned_staff: string | null;
          assigned_staff_name: string | null;
          status: string;
          notes: string | null;
          auto_invoice: boolean;
          created_at: string;
        }[];
      };
      reset_role_permissions: { Args: never; Returns: undefined };
      reverse_allocation: {
        Args: { _allocation_id: string; _reason: string };
        Returns: undefined;
      };
      reverse_payment: {
        Args: { _payment_id: string; _reason: string };
        Returns: undefined;
      };
      set_acting_firm: { Args: { _firm_id: string }; Returns: undefined };
      set_role_permission: {
        Args: {
          _amounts: boolean;
          _create: boolean;
          _delete: boolean;
          _edit: boolean;
          _module: string;
          _role: Database["public"]["Enums"]["app_role"];
          _view: boolean;
        };
        Returns: undefined;
      };
      update_job_status: {
        Args: { _job_id: string; _reason: string; _status: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "staff" | "cashier";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff", "cashier"],
    },
  },
} as const;
