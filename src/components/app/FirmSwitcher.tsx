import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentFirm, useSuperAdmin, useUserFirms } from "@/hooks/use-firm";
import { errMsg } from "@/lib/format";

import { switchActiveFirm } from "@/lib/firms.functions";

export function FirmSwitcher() {
  const { isSuperAdmin } = useSuperAdmin();
  const { data: currentFirm } = useCurrentFirm();
  const { data: userFirms } = useUserFirms();
  const qc = useQueryClient();

  const firms = userFirms ?? [];

  // If user only has access to 1 firm and is not super admin, no switcher needed
  if (!isSuperAdmin && firms.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <select
        aria-label="Switch firm"
        value={currentFirm?.id ?? ""}
        onChange={async (e) => {
          const selectedFirmId = e.target.value || null;
          try {
            await switchActiveFirm({ data: { firmId: selectedFirmId } });
          } catch {
            const { error } = await supabase.rpc("set_acting_firm", {
              _firm_id: selectedFirmId || (null as unknown as string),
            });
            if (error) return toast.error(errMsg(error));
          }
          await qc.invalidateQueries();
          toast.success("Active firm switched");
        }}
        className="h-8 max-w-[200px] truncate rounded-md border border-input bg-background px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">— Select firm —</option>
        {firms.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}
