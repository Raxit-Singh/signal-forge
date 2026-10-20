import { redirect } from "next/navigation";

// The AI step had nothing to set up and was removed from onboarding; old links go on to history.
export default async function AiStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  redirect(`/onboarding/${productId}/scan`);
}
