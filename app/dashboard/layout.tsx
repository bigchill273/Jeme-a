import { PlanProvider } from "@/features/dashboard/contexts/PlanContext";
import { auth } from "@clerk/nextjs/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkAuth = await auth.protect({ unauthenticatedUrl: "/sign-in" });

  const { has } = clerkAuth;
  const hasProPlan = has({ plan: "pro_user" });
  const hasEnterprisePlan = has({ plan: "enterprise_user" });

  return (
    <PlanProvider hasProPlan={hasProPlan} hasEnterprisePlan={hasEnterprisePlan}>
      {children}
    </PlanProvider>
  );
}
