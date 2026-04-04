import { Card, Title, Text } from "@tremor/react";

export default function NewDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nuevo Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Describe el cuadro de mando que deseas crear
        </p>
      </div>

      <Card className="max-w-2xl">
        <Title>Generador de Dashboards</Title>
        <Text className="mt-2">
          Próximamente: escribe un prompt y genera un dashboard completo.
        </Text>
      </Card>
    </div>
  );
}
