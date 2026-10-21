import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchPracticeFirms } from "@/lib/firms.functions";

export function useSuperAdmin() {
  const q = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_super_admin");
      if (error) throw error;
      return !!data;
    },
  });
  return { isSuperAdmin: !!q.data, loading: q.isLoading };
}

export function useCurrentFirm() {
  return useQuery({
    queryKey: ["current-firm"],
    queryFn: async () => {
      const { data: id } = await supabase.rpc("current_firm_id");
      if (!id) return null;
      const { data } = await supabase
        .from("firms")
        .select("*")
        .eq("id", id as string)
        .maybeSingle();
      return data;
    },
  });
}

export type UserFirmItem = {
  id: string;
  name: string;
  logo_url?: string | null;
  owner_email?: string | null;
  phone?: string | null;
  city?: string | null;
  status?: string | null;
  role?: string;
  is_current?: boolean;
};

export function useUserFirms() {
  return useQuery<UserFirmItem[]>({
    queryKey: ["user-firms-list"],
    queryFn: async (): Promise<UserFirmItem[]> => {
      let rawFirms: UserFirmItem[] = [];

      // 1. Try server function first (bypasses RLS to return all active practice firms)
      try {
        const firms = await fetchPracticeFirms();
        if (Array.isArray(firms) && firms.length > 0) {
          rawFirms = firms as UserFirmItem[];
        }
      } catch {
        // fallback
      }

      // 2. Try RPC user_firms_list
      if (rawFirms.length === 0) {
        try {
          // @ts-expect-error user_firms_list is a custom RPC
          const { data, error } = await supabase.rpc("user_firms_list");
          if (!error && Array.isArray(data) && data.length > 0) {
            rawFirms = data as unknown as UserFirmItem[];
          }
        } catch {
          // fallback
        }
      }

      // 3. Direct table select fallback
      if (rawFirms.length === 0) {
        const { data } = await supabase
          .from("firms")
          .select("id, name, logo_url, owner_email, phone, city, status")
          .order("name");
        rawFirms = (data ?? []).map((f) => ({
          ...f,
          role: "admin",
          is_current: false,
        }));
      }

      // Deduplicate firms strictly by unique id
      const seen = new Set<string>();
      return rawFirms.filter((f) => {
        if (!f?.id || seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });
    },
  });
}
