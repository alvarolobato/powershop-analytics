import { Card, Title, Text } from "@tremor/react";

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboards</h1>
        <p className="mt-1 text-sm text-gray-500">
          Crea y gestiona cuadros de mando con inteligencia artificial
        </p>
      </div>

      <Card className="max-w-lg">
        <Title>PowerShop Dashboard</Title>
        <Text className="mt-2">
          Bienvenido al generador de cuadros de mando. Describe en lenguaje
          natural el dashboard que necesitas y la IA lo creará por ti.
        </Text>
      </Card>
    </div>
  );
}
