"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
} from "@/lib/actions/categories";

type Category = {
  id: string;
  name: string;
  color: string | null;
};

interface CategoriesManagerProps {
  categories: Category[];
}

export function CategoriesManager({ categories: initialCategories }: CategoriesManagerProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  function startEdit(cat: Category) {
    setEditingId(cat.id);
    setEditValue(cat.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  function handleUpdate(id: string) {
    if (!editValue.trim()) return;
    startTransition(async () => {
      const updated = await updateCategoryAction(id, { name: editValue.trim() });
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name: updated.name } : c))
      );
      setEditingId(null);
      setEditValue("");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteCategoryAction(id);
        setCategories((prev) => prev.filter((c) => c.id !== id));
      } catch {
        toast.error("Не удалось удалить категорию");
      }
    });
  }

  function handleAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const created = await createCategoryAction(newName.trim());
      setCategories((prev) => [...prev, created]);
      setNewName("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Категории</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.id} className="flex items-center gap-2">
            {editingId === cat.id ? (
              <>
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUpdate(cat.id);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  className="flex-1"
                  autoFocus
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleUpdate(cat.id)}
                  disabled={isPending}
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={cancelEdit}
                  disabled={isPending}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{cat.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => startEdit(cat)}
                  disabled={isPending}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleDelete(cat.id)}
                  disabled={isPending}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>
        ))}

        <div className="flex items-center gap-2 pt-2">
          <Input
            placeholder="Новая категория"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={isPending || !newName.trim()}>
            Добавить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
