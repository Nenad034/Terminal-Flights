import { ManageBooking } from "@/components/ManageBooking";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold">Moja rezervacija</h1>
      <ManageBooking orderId={orderId} />
    </main>
  );
}
