import { getColumns } from "@/lib/services/columns";
import { getCategories } from "@/lib/services/categories";
import { ColumnsManager } from "@/components/settings/columns-manager";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { PinChangeForm } from "@/components/settings/pin-change-form";

export default async function SettingsPage() {
  const [columns, categories] = await Promise.all([
    getColumns(),
    getCategories(),
  ]);

  return (
    <div className="container max-w-2xl px-4 py-6 space-y-6">
      <h1 className="text-2xl font-bold">Настройки</h1>
      <ColumnsManager columns={columns} />
      <CategoriesManager categories={categories} />
      <PinChangeForm />
    </div>
  );
}
