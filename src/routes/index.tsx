import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AJ's Chartered Desk — Practice Management & Billing" },
      {
        name: "description",
        content: "The smarter workspace for Chartered Accountants.",
      },
      { property: "og:title", content: "AJ's Chartered Desk — Practice Management & Billing" },
      {
        property: "og:description",
        content: "The smarter workspace for Chartered Accountants.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return navigate({ to: "/auth", replace: true });
      const { data: sa } = await supabase.rpc("is_super_admin");
      navigate({ to: sa ? "/admin" : "/dashboard", replace: true });
    });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      Loading…
    </div>
  );
}
