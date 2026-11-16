import {
  Board,
  BoardMember,
  BoardInvitation,
  Column,
  Task,
  ActivityLogEntry,
  Comment,
} from "./supabase/models";
import { SupabaseClient } from "@supabase/supabase-js";

// ============================================
// Board Service
// ============================================
export const boardService = {
  async getBoard(supabase: SupabaseClient, boardId: string): Promise<Board> {
    const { data, error } = await supabase
      .from("boards")
      .select("*")
      .eq("id", boardId)
      .single();

    if (error) throw error;

    return data;
  },

  async getBoards(supabase: SupabaseClient, userId: string): Promise<Board[]> {
    // Get boards the user owns
    const { data: ownedBoards, error: ownedError } = await supabase
      .from("boards")
      .select(
        `
        *,
        columns (
          tasks ( count )
        )
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (ownedError) throw ownedError;

    // Get boards shared with the user (via board_members)
    const { data: memberships, error: memberError } = await supabase
      .from("board_members")
      .select("board_id, role")
      .eq("user_id", userId)
      .neq("role", "owner");

    if (memberError) throw memberError;

    const sharedBoardIds = (memberships || []).map(
      (m: { board_id: string }) => m.board_id
    );
    const membershipRoles = new Map(
      (memberships || []).map((m: { board_id: string; role: string }) => [
        m.board_id,
        m.role,
      ])
    );

    let sharedBoards: Board[] = [];
    if (sharedBoardIds.length > 0) {
      const { data: shared, error: sharedError } = await supabase
        .from("boards")
        .select(
          `
          *,
          columns (
            tasks ( count )
          )
        `
        )
        .in("id", sharedBoardIds)
        .order("created_at", { ascending: false });

      if (sharedError) throw sharedError;
      sharedBoards = shared || [];
    }

    const mapBoard = (
      board: Board & {
        columns?: Array<{ tasks?: Array<{ count: number }> }>;
      },
      role: string
    ) => {
      const totalTasks =
        board.columns?.reduce(
          (sum: number, col: { tasks?: Array<{ count: number }> }) =>
            sum + (col.tasks?.[0]?.count || 0),
          0
        ) || 0;

      const { columns, ...boardWithoutColumns } = board;
      return {
        ...boardWithoutColumns,
        totalTasks,
        role,
      };
    };

    const owned = (ownedBoards || []).map(
      (b: Board & { columns?: Array<{ tasks?: Array<{ count: number }> }> }) =>
        mapBoard(b, "owner")
    );
    const shared = sharedBoards.map(
      (b: Board & { columns?: Array<{ tasks?: Array<{ count: number }> }> }) =>
        mapBoard(b, membershipRoles.get(b.id) || "viewer")
    );

    return [...owned, ...shared];
  },

  async createBoard(
    supabase: SupabaseClient,
    board: Omit<Board, "id" | "created_at" | "updated_at">
  ): Promise<Board> {
    const { data, error } = await supabase
      .from("boards")
      .insert(board)
      .select()
      .single();

    if (error) throw error;

    return data;
  },

  async updateBoard(
    supabase: SupabaseClient,
    boardId: string,
    updates: Partial<Board>
  ): Promise<Board> {
    const { data, error } = await supabase
      .from("boards")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", boardId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getUserRole(
    supabase: SupabaseClient,
    boardId: string,
    userId: string
  ): Promise<"owner" | "editor" | "viewer" | null> {
    // First check if user is the board owner
    const { data: board } = await supabase
      .from("boards")
      .select("user_id")
      .eq("id", boardId)
      .single();

    if (board?.user_id === userId) return "owner";

    // Then check board_members
    const { data: member } = await supabase
      .from("board_members")
      .select("role")
      .eq("board_id", boardId)
      .eq("user_id", userId)
      .single();

    return (member?.role as "owner" | "editor" | "viewer") || null;
  },
};

// ============================================
// Column Service
// ============================================
export const columnService = {
  async getColumns(
    supabase: SupabaseClient,
    boardId: string
  ): Promise<Column[]> {
    const { data, error } = await supabase
      .from("columns")
      .select("*")
      .eq("board_id", boardId)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return data || [];
  },

  async createColumn(
    supabase: SupabaseClient,
    column: Omit<Column, "id" | "created_at">
  ): Promise<Column> {
    const { data, error } = await supabase
      .from("columns")
      .insert(column)
      .select()
      .single();

    if (error) throw error;

    return data;
  },

  async updateColumnTitle(
    supabase: SupabaseClient,
    columnId: string,
    title: string
  ): Promise<Column> {
    const { data, error } = await supabase
      .from("columns")
      .update({ title })
      .eq("id", columnId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteColumn(supabase: SupabaseClient, columnId: string) {
    const { data, error } = await supabase
      .from("columns")
      .delete()
      .eq("id", columnId);
    if (error) throw error;
    return data;
  },
};

// ============================================
// Task Service
// ============================================
export const taskService = {
  async getTasksByBoard(
    supabase: SupabaseClient,
    boardId: string
  ): Promise<Task[]> {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        `
        *,
        columns!inner(board_id)
        `
      )
      .eq("columns.board_id", boardId)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return data || [];
  },

  async getTasksAcrossBoards(
    supabase: SupabaseClient,
    boardIds: string[]
  ): Promise<(Task & { board_id: string; board_title?: string; board_color?: string })[]> {
    if (boardIds.length === 0) return [];

    const { data, error } = await supabase
      .from("tasks")
      .select(
        `
        *,
        columns!inner(board_id, boards!inner(title, color))
        `
      )
      .in("columns.board_id", boardIds)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true });

    if (error) throw error;

    return (data || []).map((task: Record<string, unknown>) => {
      const columns = task.columns as { board_id: string; boards: { title: string; color: string } } | undefined;
      return {
        ...task,
        board_id: columns?.board_id || "",
        board_title: columns?.boards?.title || "",
        board_color: columns?.boards?.color || "",
      };
    }) as (Task & { board_id: string; board_title?: string; board_color?: string })[];
  },

  async createTask(
    supabase: SupabaseClient,
    task: Omit<Task, "id" | "created_at" | "updated_at">
  ): Promise<Task> {
    const { data, error } = await supabase
      .from("tasks")
      .insert(task)
      .select()
      .single();

    if (error) throw error;

    return data;
  },

  async updateTask(
    supabase: SupabaseClient,
    taskId: string,
    updates: Partial<Task>
  ): Promise<Task> {
    const { data, error } = await supabase
      .from("tasks")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", taskId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async moveTask(
    supabase: SupabaseClient,
    taskId: string,
    newColumnId: string,
    newOrder: number
  ) {
    const { data, error } = await supabase
      .from("tasks")
      .update({
        column_id: newColumnId,
        sort_order: newOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    if (error) throw error;
    return data;
  },

  async deleteTask(supabase: SupabaseClient, taskId: string) {
    const { data, error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId);
    if (error) throw error;
    return data;
  },
};

// ============================================
// Board Data Service (composite operations)
// ============================================
export const boardDataService = {
  async getBoardWithColumns(supabase: SupabaseClient, boardId: string) {
    const [board, columns] = await Promise.all([
      boardService.getBoard(supabase, boardId),
      columnService.getColumns(supabase, boardId),
    ]);

    if (!board) throw new Error("Board not found");

    const tasks = await taskService.getTasksByBoard(supabase, boardId);

    const columnsWithTasks = columns.map((column) => ({
      ...column,
      tasks: tasks.filter((task) => task.column_id === column.id),
    }));

    return {
      board,
      columnsWithTasks,
    };
  },

  async createBoardWithDefaultColumns(
    supabase: SupabaseClient,
    boardData: {
      title: string;
      description?: string;
      color?: string;
      userId: string;
    }
  ) {
    const board = await boardService.createBoard(supabase, {
      title: boardData.title,
      description: boardData.description || null,
      color: boardData.color || "bg-blue-500",
      user_id: boardData.userId,
    });

    const defaultColumns = [
      { title: "To Do", sort_order: 0 },
      { title: "In Progress", sort_order: 1 },
      { title: "Review", sort_order: 2 },
      { title: "Done", sort_order: 3 },
    ];

    await Promise.all(
      defaultColumns.map((column) =>
        columnService.createColumn(supabase, {
          ...column,
          board_id: board.id,
          user_id: boardData.userId,
        })
      )
    );

    // Auto-add creator as board owner
    await boardMemberService.addMember(
      supabase,
      board.id,
      boardData.userId,
      "owner"
    );

    return board;
  },
};

// ============================================
// Board Member Service (sharing)
// ============================================
export const boardMemberService = {
  async getMembers(
    supabase: SupabaseClient,
    boardId: string
  ): Promise<BoardMember[]> {
    const { data, error } = await supabase
      .from("board_members")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async addMember(
    supabase: SupabaseClient,
    boardId: string,
    userId: string,
    role: "owner" | "editor" | "viewer",
    invitedBy?: string
  ): Promise<BoardMember> {
    const { data, error } = await supabase
      .from("board_members")
      .insert({
        board_id: boardId,
        user_id: userId,
        role,
        invited_by: invitedBy || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateRole(
    supabase: SupabaseClient,
    memberId: string,
    role: "owner" | "editor" | "viewer"
  ): Promise<BoardMember> {
    const { data, error } = await supabase
      .from("board_members")
      .update({ role })
      .eq("id", memberId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async removeMember(supabase: SupabaseClient, memberId: string) {
    const { error } = await supabase
      .from("board_members")
      .delete()
      .eq("id", memberId);
    if (error) throw error;
  },
};

// ============================================
// Board Invitation Service
// ============================================
export const boardInvitationService = {
  async getInvitations(
    supabase: SupabaseClient,
    boardId: string
  ): Promise<BoardInvitation[]> {
    const { data, error } = await supabase
      .from("board_invitations")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getMyInvitations(
    supabase: SupabaseClient,
    email: string
  ): Promise<BoardInvitation[]> {
    const { data, error } = await supabase
      .from("board_invitations")
      .select(
        `
        *,
        boards:board_id (title)
      `
      )
      .eq("invitee_email", email)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map(
      (inv: BoardInvitation & { boards?: { title: string } }) => ({
        ...inv,
        board_title: inv.boards?.title || "Unknown Board",
      })
    );
  },

  async createInvitation(
    supabase: SupabaseClient,
    boardId: string,
    inviterUserId: string,
    inviteeEmail: string,
    role: "editor" | "viewer",
    inviterName?: string
  ): Promise<BoardInvitation> {
    const { data, error } = await supabase
      .from("board_invitations")
      .insert({
        board_id: boardId,
        inviter_user_id: inviterUserId,
        invitee_email: inviteeEmail,
        role,
        status: "pending",
        inviter_name: inviterName || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async acceptInvitation(
    supabase: SupabaseClient,
    invitationId: string,
    userId: string
  ): Promise<void> {
    // Get the invitation details
    const { data: invitation, error: fetchError } = await supabase
      .from("board_invitations")
      .select("*")
      .eq("id", invitationId)
      .single();

    if (fetchError) throw fetchError;

    // Add user as board member
    await boardMemberService.addMember(
      supabase,
      invitation.board_id,
      userId,
      invitation.role,
      invitation.inviter_user_id
    );

    // Update invitation status
    const { error: updateError } = await supabase
      .from("board_invitations")
      .update({ status: "accepted" })
      .eq("id", invitationId);

    if (updateError) throw updateError;
  },

  async declineInvitation(
    supabase: SupabaseClient,
    invitationId: string
  ): Promise<void> {
    const { error } = await supabase
      .from("board_invitations")
      .update({ status: "declined" })
      .eq("id", invitationId);

    if (error) throw error;
  },

  async deleteInvitation(
    supabase: SupabaseClient,
    invitationId: string
  ): Promise<void> {
    const { error } = await supabase
      .from("board_invitations")
      .delete()
      .eq("id", invitationId);

    if (error) throw error;
  },
};

// ============================================
// Activity Log Service
// ============================================
export const activityService = {
  async logActivity(
    supabase: SupabaseClient,
    entry: Omit<ActivityLogEntry, "id" | "created_at">
  ): Promise<void> {
    const { error } = await supabase.from("activity_log").insert(entry);
    // Silently fail activity logging — it's non-critical
    if (error) console.error("Failed to log activity:", error);
  },

  async getActivityLog(
    supabase: SupabaseClient,
    boardId: string,
    limit: number = 50
  ): Promise<ActivityLogEntry[]> {
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  async getTaskActivity(
    supabase: SupabaseClient,
    taskId: string,
    limit: number = 20
  ): Promise<ActivityLogEntry[]> {
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("entity_id", taskId)
      .eq("entity_type", "task")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },
};

// ============================================
// Comment Service
// ============================================
export const commentService = {
  async getComments(
    supabase: SupabaseClient,
    taskId: string
  ): Promise<Comment[]> {
    const { data, error } = await supabase
      .from("comments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async addComment(
    supabase: SupabaseClient,
    comment: Omit<Comment, "id" | "created_at" | "updated_at">
  ): Promise<Comment> {
    const { data, error } = await supabase
      .from("comments")
      .insert(comment)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateComment(
    supabase: SupabaseClient,
    commentId: string,
    content: string
  ): Promise<Comment> {
    const { data, error } = await supabase
      .from("comments")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", commentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteComment(supabase: SupabaseClient, commentId: string) {
    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", commentId);
    if (error) throw error;
  },

  async getCommentCount(
    supabase: SupabaseClient,
    taskIds: string[]
  ): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();

    const { data, error } = await supabase
      .from("comments")
      .select("task_id")
      .in("task_id", taskIds);

    if (error) throw error;

    const counts = new Map<string, number>();
    (data || []).forEach((c: { task_id: string }) => {
      counts.set(c.task_id, (counts.get(c.task_id) || 0) + 1);
    });
    return counts;
  },
};
