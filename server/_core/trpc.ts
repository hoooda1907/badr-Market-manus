import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { employeeHas, getEmployeeForToken } from "./employee-auth";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const employeeProcedure = t.procedure.use(async (opts) => {
  const token = opts.ctx.req.header("x-employee-session");
  const employee = await getEmployeeForToken(token);
  if (!employee) throw new TRPCError({ code: "UNAUTHORIZED", message: "يلزم تسجيل دخول الموظف" });
  return opts.next({ ctx: { ...opts.ctx, employee } });
});

export const permissionProcedure = (permission: string) =>
  employeeProcedure.use(({ ctx, next }) => {
    if (!employeeHas(ctx.employee, permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تنفيذ هذا الإجراء" });
    }
    return next({ ctx });
  });

export const managerProcedure = t.procedure.use(async (opts) => {
  if (opts.ctx.user?.role === "admin") return opts.next({ ctx: { ...opts.ctx, employee: null } });
  const employee = await getEmployeeForToken(opts.ctx.req.header("x-employee-session"));
  if (!employee || employee.role !== "manager") {
    throw new TRPCError({ code: "FORBIDDEN", message: "هذه العملية متاحة لمدير المتجر فقط" });
  }
  return opts.next({ ctx: { ...opts.ctx, employee } });
});

export const adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
