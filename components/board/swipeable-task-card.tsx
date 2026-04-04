"use client";

import { useRef, useState, useCallback, type TouchEvent } from "react";
import { ArrowRightLeft } from "lucide-react";
import { TaskCard } from "./task-card";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal";
  categoryId: string | null;
  plannedDate: string | null;
  completedAt: Date | null;
};

type Category = {
  id: string;
  name: string;
  color: string | null;
};

interface SwipeableTaskCardProps {
  task: Task;
  categories: Category[];
  onClick: () => void;
  onMovePress: () => void;
}

const SWIPE_THRESHOLD = 60;
const GAP = 8;
const BUTTON_WIDTH = 72;
const SWIPE_WIDTH = BUTTON_WIDTH + GAP;

export function SwipeableTaskCard({
  task,
  categories,
  onClick,
  onMovePress,
}: SwipeableTaskCardProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const isVerticalRef = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    setIsDragging(false);
    isVerticalRef.current = false;
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startXRef.current;
      const dy = e.touches[0].clientY - startYRef.current;

      if (!isVerticalRef.current) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5) {
          isVerticalRef.current = true;
          return;
        }
        if (Math.abs(dx) > 5) {
          setIsDragging(true);
        }
      }

      if (isVerticalRef.current) return;

      if (Math.abs(dx) > 5) {
        const base = isOpen ? -SWIPE_WIDTH : 0;
        const next = base + dx;
        setOffsetX(Math.max(-SWIPE_WIDTH, Math.min(0, next)));
      }
    },
    [isOpen],
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    if (isVerticalRef.current) return;

    if (offsetX < -SWIPE_THRESHOLD) {
      setOffsetX(-SWIPE_WIDTH);
      setIsOpen(true);
    } else {
      setOffsetX(0);
      setIsOpen(false);
    }
  }, [offsetX]);

  const handleMovePress = useCallback(() => {
    setOffsetX(0);
    setIsOpen(false);
    onMovePress();
  }, [onMovePress]);

  const handleClick = useCallback(() => {
    if (isOpen) {
      setOffsetX(0);
      setIsOpen(false);
      return;
    }
    onClick();
  }, [isOpen, onClick]);

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Кнопка перемещения */}
      <button
        onClick={handleMovePress}
        className="absolute inset-y-0 flex items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
        style={{ width: BUTTON_WIDTH, right: 0 }}
        aria-label="Переместить задачу"
      >
        <ArrowRightLeft className="size-5" />
      </button>

      {/* Карточка */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isDragging ? "none" : "transform 200ms ease-out",
        }}
      >
        <TaskCard
          task={task}
          categories={categories}
          onClick={handleClick}
        />
      </div>
    </div>
  );
}
