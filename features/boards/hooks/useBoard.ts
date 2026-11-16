"use client";

import {
  boardDataService,
  boardService,
  columnService,
  taskService,
} from "@/lib/services";
import { Board, ColumnWithTasks, Task } from "@/lib/supabase/models";
import { useSupabase } from "@/providers/SupabaseProvider";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export function useBoard(boardId: string) {
  const { supabase, isLoaded } = useSupabase();
  const { user } = useUser();

  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<ColumnWithTasks[]>([]);
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{
    boardId: string;
    message: string;
  } | null>(null);
  const loading = loadedBoardId !== boardId;
  const displayError =
    error ?? (loadError?.boardId === boardId ? loadError.message : null);

  useEffect(() => {
    if (!boardId || !isLoaded || !supabase) return;

    let isCurrent = true;
    void boardDataService
      .getBoardWithColumns(supabase, boardId)
      .then((data) => {
        if (!isCurrent) return;
        setBoard(data.board);
        setColumns(data.columnsWithTasks);
        setError(null);
        setLoadError(null);
      })
      .catch((err) => {
        if (!isCurrent) return;
        setLoadError({
          boardId,
          message:
            err instanceof Error ? err.message : "Failed to load boards.",
        });
      })
      .finally(() => {
        if (isCurrent) setLoadedBoardId(boardId);
      });

    return () => {
      isCurrent = false;
    };
  }, [boardId, isLoaded, supabase]);

  async function updateBoard(boardId: string, updates: Partial<Board>) {
    try {
      const updatedBoard = await boardService.updateBoard(
        supabase!,
        boardId,
        updates
      );
      setBoard(updatedBoard);
      return updatedBoard;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update the board."
      );
    }
  }

  async function createRealTask(
    columnId: string,
    taskData: {
      title: string;
      description?: string;
      assignee?: string;
      dueDate?: string;
      priority?: "low" | "medium" | "high";
    }
  ) {
    try {
      const newTask = await taskService.createTask(supabase!, {
        title: taskData.title,
        description: taskData.description || null,
        assignee: taskData.assignee || null,
        due_date: taskData.dueDate || null,
        column_id: columnId,
        sort_order:
          columns.find((col) => col.id === columnId)?.tasks.length || 0,
        priority: taskData.priority || "medium",
      });

      setColumns((prev) =>
        prev.map((col) =>
          col.id == columnId ? { ...col, tasks: [...col.tasks, newTask] } : col
        )
      );

      return newTask;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create the task."
      );
    }
  }

  async function moveTask(
    taskId: string,
    newColumnId: string,
    newOrder: number
  ) {
    const prevColumns = structuredClone(columns);
    try {
      setColumns((prev) => {
        const newColumns = [...prev];

        // Find and remove task from the old column
        let taskToMove: Task | null = null;
        for (const col of newColumns) {
          const taskIndex = col.tasks.findIndex((task) => task.id === taskId);
          if (taskIndex !== -1) {
            taskToMove = col.tasks[taskIndex];
            col.tasks.splice(taskIndex, 1);
            break;
          }
        }

        if (taskToMove) {
          // Add task to new column
          const targetColumn = newColumns.find((col) => col.id === newColumnId);
          if (targetColumn) {
            targetColumn.tasks.splice(newOrder, 0, taskToMove);
          }
        }

        return newColumns;
      });
      await taskService.moveTask(supabase!, taskId, newColumnId, newOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move task.");
      // Rollback UI to previous state
      console.log("columns", columns);
      console.log("prev", prevColumns);
      setColumns(prevColumns);
    }
  }

  async function createColumn(title: string) {
    if (!board || !user) throw new Error("Board not loaded");

    try {
      const newColumn = await columnService.createColumn(supabase!, {
        title,
        board_id: board.id,
        sort_order: columns.length,
        user_id: user.id,
      });

      setColumns((prev) => [...prev, { ...newColumn, tasks: [] }]);
      return newColumn;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create column.");
    }
  }

  async function updateColumn(columnId: string, title: string) {
    try {
      const updatedColumn = await columnService.updateColumnTitle(
        supabase!,
        columnId,
        title
      );

      setColumns((prev) =>
        prev.map((col) =>
          col.id === columnId ? { ...col, ...updatedColumn } : col
        )
      );

      return updatedColumn;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create column.");
    }
  }

  async function deleteRealTask(taskId: string) {
    const prevColumns = structuredClone(columns);
    try {
      setColumns((prev) =>
        prev.map((col) => ({
          ...col,
          tasks: col.tasks.filter((t) => t.id !== taskId),
        }))
      );
      await taskService.deleteTask(supabase!, taskId);
    } catch (err) {
      console.error("Failed to delete task:", err);
      setColumns(prevColumns);
    }
  }

  async function deleteRealColumn(columnId: string) {
    const prevColumns = structuredClone(columns);
    try {
      setColumns((prev) => prev.filter((c) => c.id !== columnId));
      await columnService.deleteColumn(supabase!, columnId);
    } catch (err) {
      console.error("Failed to delete column:", err);
      setColumns(prevColumns);
    }
  }

  return {
    board,
    columns,
    setColumns,
    loading,
    error: displayError,
    updateBoard,
    createRealTask,
    moveTask,
    createColumn,
    updateColumn,
    deleteRealTask,
    deleteRealColumn,
  };
}
