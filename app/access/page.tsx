import { AccessGateForm } from '@/components/access/access-gate-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { translations } from '@/lib/i18n';

export default function AccessPage() {
  const messages = translations.km;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{messages.accessGate.title}</CardTitle>
          <CardDescription>{messages.accessGate.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <AccessGateForm />
        </CardContent>
      </Card>
    </main>
  );
}
