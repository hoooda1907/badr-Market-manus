import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as XLSX from "xlsx";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/screen-container";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { parseProductRows, type ImportedProduct } from "@/shared/product-import";
import * as EmployeeSession from "@/lib/employee-session";
import type { EmployeeRole, LocalEmployeeSession, PaymentMethod } from "@/lib/local-store/types";
import {
  addLocalExpense,
  changeLocalManagerPassword,
  checkoutLocalSale,
  clockLocalAttendance,
  closeLocalShift,
  createInitialManager,
  createLocalEmployee,
  createLocalProduct,
  createLocalReceipt,
  getCurrentLocalShift,
  getLocalAttendance,
  getLocalBestSellers,
  getLocalEmployeeReport,
  getLocalEmployeeSession,
  getLocalExpenses,
  getLocalInventoryReport,
  getLocalShiftReport,
  getLocalSummary,
  hasManagerAccount,
  importLocalProducts,
  initializeLocalStore,
  listLocalEmployees,
  listLocalProducts,
  loginLocalEmployee,
  openLocalShift,
  setCountedQuantity,
  setLocalEmployeeActive,
} from "@/lib/local-store/service";

const C = { green: "#079455", darkGreen: "#12613d", pale: "#e9f6ee", bg: "#f3f7f4", white: "#ffffff", ink: "#183027", muted: "#718078", line: "#dfe9e2", orange: "#d97813", red: "#c83d3d", blue: "#2868a8" };
const extraStyles = StyleSheet.create({
  hotkeyHint: { color: C.muted, fontSize: 10, textAlign: "right", marginBottom: 6 },
  cartRowSelected: { backgroundColor: C.pale, borderRadius: 8, paddingHorizontal: 8 },
  reportBlock: { borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 8 },
});
type ScreenKey = "home" | "products" | "sale" | "inventory" | "receive" | "staff" | "reports" | "accounts" | "prices";
type ProductView = { id: number; externalId: string | null; barcode: string | null; name: string; cost: string; price: string; onHand: string; countedQty: string | null; unit: string; location: string | null };
type CartLine = { product: ProductView; quantity: number };
const NAV: { id: ScreenKey; title: string; icon: keyof typeof Ionicons.glyphMap; permission?: string }[] = [
  { id: "home", title: "الرئيسية", icon: "grid-outline" },
  { id: "sale", title: "نقطة البيع", icon: "cart-outline", permission: "sales:create" },
  { id: "products", title: "المنتجات", icon: "pricetag-outline", permission: "products:view" },
  { id: "inventory", title: "المخزون والجرد", icon: "cube-outline", permission: "inventory:view" },
  { id: "receive", title: "استلام مشتريات", icon: "download-outline", permission: "receipts:create" },
  { id: "staff", title: "الموظفون", icon: "people-outline", permission: "staff:manage" },
  { id: "reports", title: "التقارير", icon: "bar-chart-outline", permission: "reports:view" },
  { id: "accounts", title: "الحسابات والمصروفات", icon: "wallet-outline", permission: "accounts:manage" },
  { id: "prices", title: "استعلام السعر", icon: "search-outline", permission: "products:view" },
];
const money = (v: number | string | null | undefined) => `${(Number(v) || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م.`;
const qty = (v: number | string | null | undefined) => (Number(v) || 0).toLocaleString("ar-EG", { maximumFractionDigits: 3 });

function Field({ label, value, onChangeText, placeholder, keyboardType = "default", secureTextEntry = false, onSubmitEditing, autoFocus = false }: { label?: string; value: string; onChangeText: (text: string) => void; placeholder?: string; keyboardType?: "default" | "numeric" | "decimal-pad"; secureTextEntry?: boolean; onSubmitEditing?: () => void; autoFocus?: boolean }) {
  return <View style={styles.fieldWrap}>{label ? <Text style={styles.fieldLabel}>{label}</Text> : null}<TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#98a79d" keyboardType={keyboardType} secureTextEntry={secureTextEntry} onSubmitEditing={onSubmitEditing} autoFocus={autoFocus} style={styles.input} returnKeyType={onSubmitEditing ? "search" : "done"} autoCapitalize="none" /></View>;
}
function Action({ title, onPress, icon, secondary = false, disabled = false }: { title: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; secondary?: boolean; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.action, secondary && styles.actionSecondary, disabled && { opacity: 0.48 }]}>{icon ? <Ionicons name={icon} size={18} color={secondary ? C.darkGreen : C.white} /> : null}<Text style={[styles.actionText, secondary && styles.actionSecondaryText]}>{title}</Text></Pressable>;
}
function Card({ children, style }: { children: React.ReactNode; style?: object }) { return <View style={[styles.card, style]}>{children}</View>; }
function SectionTitle({ title, hint }: { title: string; hint?: string }) { return <View style={styles.sectionTitle}><Text style={styles.h2}>{title}</Text>{hint ? <Text style={styles.muted}>{hint}</Text> : null}</View>; }
function AppModal({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalCard}><View style={styles.modalHeader}><Text style={styles.h2}>{title}</Text><Pressable onPress={onClose} accessibilityLabel="إغلاق"><Ionicons name="close" size={24} color={C.muted} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView></View></View></Modal>;
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const queryClient = useQueryClient();
  const [employee, setEmployee] = useState<LocalEmployeeSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [hasManager, setHasManager] = useState(false);
  const [screen, setScreen] = useState<ScreenKey>("home");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [pin, setPin] = useState("");
  const [managerSetupPassword, setManagerSetupPassword] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedCartProductId, setSelectedCartProductId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paid, setPaid] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", barcode: "", cost: "", price: "", onHand: "0", unit: "قطعة", location: "" });
  const [importPreview, setImportPreview] = useState<{ items: ImportedProduct[]; issues: string[] } | null>(null);
  const [countTarget, setCountTarget] = useState<ProductView | null>(null);
  const [countValue, setCountValue] = useState("");
  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [receiptLines, setReceiptLines] = useState<{ product: ProductView; quantity: number; cost: number }[]>([]);
  const [employeeModal, setEmployeeModal] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ code: "", name: "", pin: "", password: "", role: "cashier" as EmployeeRole, phone: "" });
  const [passwordModal, setPasswordModal] = useState(false);
  const [currentManagerPassword, setCurrentManagerPassword] = useState("");
  const [nextManagerPassword, setNextManagerPassword] = useState("");
  const [expenseModal, setExpenseModal] = useState(false);
  const [newExpense, setNewExpense] = useState({ category: "تشغيل", description: "", amount: "", paymentMethod: "cash" as "cash" | "card" | "wallet" });
  const posInputRef = useRef<TextInput>(null);
  const cartTotal = cart.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeLocalStore();
        const configured = await hasManagerAccount();
        const employeeId = await EmployeeSession.getEmployeeId();
        const restored = employeeId == null ? null : await getLocalEmployeeSession(employeeId);
        if (!active) return;
        setHasManager(configured);
        setEmployee(restored);
        if (!restored && employeeId != null) await EmployeeSession.clearEmployeeSession();
      } catch (error) {
        if (active) setNotice(messageOf(error, "تعذر فتح قاعدة البيانات المحلية"));
      } finally {
        if (active) setSessionReady(true);
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (screen !== "sale" || Platform.OS !== "web") return;
    const timer = setTimeout(() => posInputRef.current?.focus(), 220);
    return () => clearTimeout(timer);
  }, [screen]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
      const cashier = employee?.role === "manager" || employee?.role === "cashier";
      if (event.key === "F2" && cashier) {
        event.preventDefault(); setScreen("sale"); setTimeout(() => posInputRef.current?.focus(), 250);
      } else if (event.key === "F3" && employee) {
        event.preventDefault(); setScreen("prices"); setSearch("");
      } else if (event.key === "F4" && cart.length && cashier) {
        event.preventDefault(); setPaid(cartTotal.toFixed(2)); setCheckoutOpen(true);
      } else if (event.key === "F6" && (employee?.role === "manager" || employee?.role === "stock")) {
        event.preventDefault(); setScreen("receive"); setSearch("");
      } else if (event.key === "F7" && (employee?.role === "manager" || employee?.role === "stock")) {
        event.preventDefault(); setScreen("inventory"); setSearch("");
      } else if (event.key === "F8" && (employee?.role === "manager" || employee?.role === "stock")) {
        event.preventDefault(); setScreen("products"); setSearch("");
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && cart.length && cashier) {
        event.preventDefault(); setPaid(cartTotal.toFixed(2)); setCheckoutOpen(true);
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Backspace" && screen === "sale") {
        event.preventDefault(); setCart([]); setSelectedCartProductId(null);
      } else if (!editing && screen === "sale" && cart.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const current = cart.findIndex(line => line.product.id === selectedCartProductId);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = current < 0 ? (delta > 0 ? 0 : cart.length - 1) : (current + delta + cart.length) % cart.length;
        setSelectedCartProductId(cart[next].product.id);
      } else if (!editing && screen === "sale" && selectedCartProductId !== null && (event.key === "+" || event.key === "=" || event.key === "-")) {
        event.preventDefault();
        const delta = event.key === "-" ? -1 : 1;
        setCart(current => current.map(line => line.product.id === selectedCartProductId ? { ...line, quantity: Math.max(1, line.quantity + delta) } : line));
      } else if (!editing && screen === "sale" && selectedCartProductId !== null && event.key === "Delete") {
        event.preventDefault(); setCart(current => current.filter(line => line.product.id !== selectedCartProductId)); setSelectedCartProductId(null);
      } else if (event.key === "Escape") {
        if (checkoutOpen) setCheckoutOpen(false);
        else if (scannerOpen) setScannerOpen(false);
        else if (importPreview) setImportPreview(null);
        else if (productModal) setProductModal(false);
        else if (employeeModal) setEmployeeModal(false);
        else if (passwordModal) setPasswordModal(false);
        else if (expenseModal) setExpenseModal(false);
        else if (countTarget) setCountTarget(null);
        else setSearch("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cart, cartTotal, checkoutOpen, countTarget, employee, employeeModal, expenseModal, importPreview, passwordModal, productModal, scannerOpen, screen, selectedCartProductId]);
  const loggedIn = Boolean(employee);
  const productsQuery = useQuery({ queryKey: ["localProducts", employee?.id, search.trim()], queryFn: () => listLocalProducts(employee!, search.trim(), 300), enabled: loggedIn, staleTime: 0 });
  const shiftQuery = useQuery({ queryKey: ["localShift", employee?.id], queryFn: () => getCurrentLocalShift(employee!), enabled: loggedIn && (employee?.role === "manager" || employee?.role === "cashier"), retry: false });
  const summaryQuery = useQuery({ queryKey: ["localSummary", employee?.id], queryFn: () => getLocalSummary(employee!), enabled: loggedIn && employee?.role === "manager", retry: false });
  const bestQuery = useQuery({ queryKey: ["localBestSellers", employee?.id], queryFn: () => getLocalBestSellers(employee!), enabled: loggedIn && employee?.role === "manager", retry: false });
  const inventoryReportQuery = useQuery({ queryKey: ["localInventoryReport", employee?.id], queryFn: () => getLocalInventoryReport(employee!), enabled: screen === "reports" && employee?.role === "manager", retry: false });
  const shiftReportQuery = useQuery({ queryKey: ["localShiftReport", employee?.id], queryFn: () => getLocalShiftReport(employee!), enabled: screen === "reports" && employee?.role === "manager", retry: false });
  const employeeReportQuery = useQuery({ queryKey: ["localEmployeeReport", employee?.id], queryFn: () => getLocalEmployeeReport(employee!), enabled: screen === "reports" && employee?.role === "manager", retry: false });
  const staffQuery = useQuery({ queryKey: ["localEmployees", employee?.id], queryFn: () => listLocalEmployees(employee!), enabled: loggedIn && employee?.role === "manager", retry: false });
  const attendanceQuery = useQuery({ queryKey: ["localAttendance", employee?.id], queryFn: () => getLocalAttendance(employee!), enabled: screen === "staff" && employee?.role === "manager", retry: false });
  const expensesQuery = useQuery({ queryKey: ["localExpenses", employee?.id], queryFn: () => getLocalExpenses(employee!), enabled: screen === "accounts" && employee?.role === "manager", retry: false });

  const employeeLogin = useMutation({ mutationFn: (input: { code: string; pin: string }) => loginLocalEmployee(input.code, input.pin) });
  const employeeCreate = useMutation({ mutationFn: (input: { code: string; name: string; pin: string; password?: string; role: EmployeeRole; phone?: string }) => createLocalEmployee(employee!, input) });
  const passwordChange = useMutation({ mutationFn: (input: { currentPassword: string; newPassword: string }) => changeLocalManagerPassword(employee!, input.currentPassword, input.newPassword) });
  const employeeActive = useMutation({ mutationFn: (input: { id: number; active: boolean }) => setLocalEmployeeActive(employee!, input.id, input.active) });
  const importProducts = useMutation({ mutationFn: (input: { items: ImportedProduct[] }) => importLocalProducts(employee!, input.items) });
  const createProduct = useMutation({ mutationFn: (input: ImportedProduct) => createLocalProduct(employee!, input) });
  const setCounted = useMutation({ mutationFn: (input: { id: number; countedQty: number }) => setCountedQuantity(employee!, input.id, input.countedQty) });
  const openShift = useMutation({ mutationFn: (input: { openingCash: number }) => openLocalShift(employee!, input.openingCash) });
  const closeShift = useMutation({ mutationFn: (input: { id: number; actualCash: number }) => closeLocalShift(employee!, input.id, input.actualCash) });
  const checkout = useMutation({ mutationFn: (input: { lines: { productId: number; quantity: number }[]; paymentMethod: PaymentMethod; paid: number; shiftId?: number }) => checkoutLocalSale(employee!, input) });
  const receive = useMutation({ mutationFn: (input: { supplier: string; invoiceNo?: string; lines: { productId: number; quantity: number; cost: number }[] }) => createLocalReceipt(employee!, input) });
  const clock = useMutation({ mutationFn: () => clockLocalAttendance(employee!) });
  const addExpense = useMutation({ mutationFn: (input: { category: string; description: string; amount: number; paymentMethod: "cash" | "card" | "wallet"; shiftId?: number }) => addLocalExpense(employee!, input) });

  const items = (productsQuery.data ?? []) as ProductView[];
  const canManage = employee?.role === "manager";
  const allowed = (id: ScreenKey) => {
    if (id === "home") return true;
    if (id === "staff" || id === "reports" || id === "accounts") return canManage;
    if (id === "sale") return employee?.role === "manager" || employee?.role === "cashier";
    if (id === "products") return employee?.role === "manager" || employee?.role === "stock";
    if (id === "prices") return loggedIn;
    if (id === "receive" || id === "inventory") return employee?.role === "manager" || employee?.role === "stock";
    return true;
  };
  const visibleNav = NAV.filter((item) => allowed(item.id));
  const refreshProducts = useCallback(() => { void queryClient.invalidateQueries({ queryKey: ["localProducts"] }); }, [queryClient]);
  const flash = (text: string) => { setNotice(text); setTimeout(() => setNotice(""), 4200); };

  const loginStaff = async () => {
    try {
      const result = await employeeLogin.mutateAsync({ code: staffCode.trim(), pin });
      await EmployeeSession.setEmployeeSession(result);
      setEmployee(result); setPin(""); setScreen("home"); flash(`أهلًا ${result.name}`);
    } catch (error) { flash(messageOf(error, "تعذر تسجيل الدخول")); }
  };
  const logoutStaff = async () => {
    await EmployeeSession.clearEmployeeSession(); queryClient.clear(); setEmployee(null); setCart([]); setScreen("home");
  };
  const performClock = async () => {
    try { const result = await clock.mutateAsync(); flash(result.event === "in" ? "تم تسجيل الحضور" : "تم تسجيل الانصراف"); void attendanceQuery.refetch(); }
    catch (error) { flash(messageOf(error, "تعذر تسجيل الحضور والانصراف")); }
  };
  const commitExpense = async () => {
    const amount = Number(newExpense.amount);
    if (!newExpense.description.trim() || !Number.isFinite(amount) || amount <= 0) { flash("أدخل بيان المصروف ومبلغًا صحيحًا"); return; }
    try {
      await addExpense.mutateAsync({ category: newExpense.category.trim() || "عام", description: newExpense.description.trim(), amount, paymentMethod: newExpense.paymentMethod, shiftId: shiftQuery.data?.id });
      setNewExpense({ category: "تشغيل", description: "", amount: "", paymentMethod: "cash" });
      setExpenseModal(false);
      void expensesQuery.refetch(); void summaryQuery.refetch();
      flash("تم تسجيل المصروف في دفتر الحسابات");
    } catch (error) { flash(messageOf(error, "تعذر تسجيل المصروف")); }
  };
  const lookup = async (value: string) => {
    const clean = value.trim(); if (!clean) return null;
    if (!employee) return null;
    const matches = await listLocalProducts(employee, clean, 100);
    return matches.find((p) => p.barcode === clean) ?? matches.find((p) => p.name.toLowerCase().includes(clean.toLowerCase())) ?? null;
  };
  const addToCart = (product: ProductView) => {
    setCart((previous) => {
      const found = previous.find((line) => line.product.id === product.id);
      if (found) return previous.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...previous, { product, quantity: 1 }];
    });
    setSelectedCartProductId(product.id);
    setSearch(""); flash(`أضيف ${product.name} إلى الفاتورة`);
  };
  const submitBarcode = async (target: "sale" | "receive" | "inventory", value = search) => {
    try {
      const product = await lookup(value);
      if (!product) { flash("لم أجد الصنف؛ اختره من النتائج أو تأكد من الباركود"); return; }
      if (target === "sale") addToCart(product);
      else if (target === "receive") addReceiptProduct(product);
      else { setCountTarget(product); setCountValue(String(product.countedQty ?? product.onHand)); }
      setSearch("");
    } catch (error) { flash(messageOf(error, "تعذر البحث عن المنتج")); }
  };
  const addReceiptProduct = (product: ProductView) => setReceiptLines((previous) => {
    const existing = previous.find((line) => line.product.id === product.id);
    return existing ? previous.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line) : [...previous, { product, quantity: 1, cost: Number(product.cost) }];
  });
  const openImportPicker = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv"], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const workbook = Platform.OS === "web"
        ? XLSX.read(await (await fetch(asset.uri)).arrayBuffer(), { type: "array" })
        : XLSX.read(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }), { type: "base64" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
      const preview = parseProductRows(rows);
      setImportPreview(preview);
    } catch (error) { flash(messageOf(error, "تعذر فتح الملف")); }
  };
  const commitImport = async () => {
    if (!importPreview?.items.length) return;
    try {
      const result = await importProducts.mutateAsync({ items: importPreview.items });
      setImportPreview(null); refreshProducts(); flash(`تم استيراد/تحديث ${result.imported} صنف`);
    } catch (error) { flash(messageOf(error, "تعذر استيراد المنتجات")); }
  };
  const commitProduct = async () => {
    if (!newProduct.name.trim()) { flash("اكتب اسم الصنف"); return; }
    try {
      await createProduct.mutateAsync({ name: newProduct.name.trim(), barcode: newProduct.barcode.trim() || undefined, cost: Number(newProduct.cost) || 0, price: Number(newProduct.price) || 0, onHand: Number(newProduct.onHand) || 0, unit: newProduct.unit.trim() || "قطعة", location: newProduct.location.trim() || undefined });
      setProductModal(false); setNewProduct({ name: "", barcode: "", cost: "", price: "", onHand: "0", unit: "قطعة", location: "" }); refreshProducts(); flash("تم حفظ الصنف");
    } catch (error) { flash(messageOf(error, "تعذر حفظ الصنف")); }
  };
  const commitCount = async () => {
    if (!countTarget || !Number.isFinite(Number(countValue)) || Number(countValue) < 0) return;
    try {
      await setCounted.mutateAsync({ id: countTarget.id, countedQty: Number(countValue) });
      setCountTarget(null); refreshProducts(); flash("تم تسجيل الجرد وتسوية الرصيد");
    } catch (error) { flash(messageOf(error, "تعذر حفظ الجرد")); }
  };
  const commitSale = async () => {
    if (!cart.length) return;
    const shiftId = shiftQuery.data?.id;
    if (!shiftId) { flash("افتح وردية قبل إتمام البيع"); return; }
    try {
      const result = await checkout.mutateAsync({ lines: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })), paymentMethod, paid: Number(paid) || cartTotal, shiftId });
      setCart([]); setCheckoutOpen(false); setPaid(""); setScreen("home"); refreshProducts(); void summaryQuery.refetch(); void bestQuery.refetch(); void shiftQuery.refetch(); flash(`تم حفظ الفاتورة ${result.receiptNo} — الإجمالي ${money(result.total)}`);
    } catch (error) { flash(messageOf(error, "تعذر إتمام البيع")); }
  };
  const commitReceipt = async () => {
    if (!supplier.trim() || !receiptLines.length) { flash("أدخل اسم المورد وأضف صنفًا واحدًا على الأقل"); return; }
    try {
      const result = await receive.mutateAsync({ supplier: supplier.trim(), invoiceNo: invoiceNo.trim() || undefined, lines: receiptLines.map((line) => ({ productId: line.product.id, quantity: line.quantity, cost: line.cost })) });
      setSupplier(""); setInvoiceNo(""); setReceiptLines([]); refreshProducts(); void summaryQuery.refetch(); flash(`تم حفظ الاستلام ${result.reference} وتحديث المخزون`);
    } catch (error) { flash(messageOf(error, "تعذر حفظ الاستلام")); }
  };
  const commitEmployee = async () => {
    if (!newEmployee.code.trim() || !newEmployee.name.trim()) { flash("أدخل كود الموظف واسمه"); return; }
    if (newEmployee.role === "manager" ? newEmployee.password.length < 8 : !/^\d{4,12}$/.test(newEmployee.pin)) { flash(newEmployee.role === "manager" ? "كلمة مرور المدير 8 أحرف على الأقل" : "PIN الموظف يجب أن يتكون من 4 إلى 12 رقمًا"); return; }
    try {
      await employeeCreate.mutateAsync(newEmployee);
      setEmployeeModal(false); setNewEmployee({ code: "", name: "", pin: "", password: "", role: "cashier", phone: "" }); void staffQuery.refetch(); flash("تم تسجيل الموظف وتعيين الدور على هذا الجهاز");
    } catch (error) { flash(messageOf(error, "تعذر إضافة الموظف")); }
  };
  const createFirstManager = async () => {
    if (!newEmployee.code.trim() || !newEmployee.name.trim() || managerSetupPassword.length < 8) { flash("أدخل كود المدير واسمه وكلمة مرور من 8 أحرف على الأقل"); return; }
    try {
      const result = await createInitialManager({ code: newEmployee.code.trim(), name: newEmployee.name.trim(), password: managerSetupPassword });
      await EmployeeSession.setEmployeeSession(result); setEmployee(result); setHasManager(true); setManagerSetupPassword(""); setNewEmployee({ code: "", name: "", pin: "", password: "", role: "cashier", phone: "" }); setPin(""); setScreen("home"); flash("تم إنشاء المدير وتسجيل الدخول محليًا");
    } catch (error) { flash(messageOf(error, "تعذر إنشاء المدير")); }
  };
  const commitManagerPassword = async () => {
    if (nextManagerPassword.length < 8) { flash("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل"); return; }
    try {
      await passwordChange.mutateAsync({ currentPassword: currentManagerPassword, newPassword: nextManagerPassword });
      setCurrentManagerPassword(""); setNextManagerPassword(""); setPasswordModal(false); flash("تم تغيير كلمة مرور المدير على هذا الجهاز");
    } catch (error) { flash(messageOf(error, "تعذر تغيير كلمة المرور")); }
  };

  if (!sessionReady) return <ScreenContainer className="flex-1"><View style={styles.center}><Text style={styles.muted}>جارٍ تجهيز قاعدة أسواق بدر المحلية…</Text></View></ScreenContainer>;
  if (!employee) {
    return <ScreenContainer className="flex-1" style={styles.screen}><View style={styles.loginWrap}>
      <Image source={require("../../assets/images/icon.png")} style={styles.logo} resizeMode="contain" />
      <Text style={styles.brandTitle}>أسواق بدر</Text><Text style={styles.brandSubtitle}>برنامج محلي — بيانات هذا الجهاز فقط</Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {!hasManager ? <Card><SectionTitle title="إعداد مدير المتجر" hint="أنشئ الحساب الأول واختر كلمة المرور بنفسك؛ لا توجد كلمة مرور افتراضية." />
        <Field label="كود الدخول" value={newEmployee.code} onChangeText={(code) => setNewEmployee({ ...newEmployee, code })} placeholder="مثال: MGR01" />
        <Field label="اسم المدير" value={newEmployee.name} onChangeText={(name) => setNewEmployee({ ...newEmployee, name })} placeholder="اسم المدير" />
        <Field label="كلمة مرور المدير (8 أحرف على الأقل)" value={managerSetupPassword} onChangeText={setManagerSetupPassword} placeholder="اختر كلمة مرور" secureTextEntry />
        <Action title="إنشاء المدير والدخول" icon="shield-checkmark-outline" onPress={createFirstManager} disabled={employeeLogin.isPending} />
      </Card> : <Card><SectionTitle title="دخول الموظف" hint="أدخل كود الموظف؛ استخدم كلمة مرور المدير أو PIN الموظف." />
        <Field label="كود الموظف" value={staffCode} onChangeText={setStaffCode} placeholder="كود الموظف" autoFocus />
        <Field label="كلمة المرور / PIN" value={pin} onChangeText={setPin} placeholder="أدخل بيانات الدخول" secureTextEntry onSubmitEditing={loginStaff} />
        <Action title={employeeLogin.isPending ? "جارٍ التحقق…" : "تسجيل الدخول"} icon="log-in-outline" onPress={loginStaff} disabled={employeeLogin.isPending} />
      </Card>}
      <Text style={styles.loginFoot}>لا يتصل هذا التطبيق بخادم ولا يزامن بياناته مع أجهزة أخرى.</Text>
    </View></ScreenContainer>;
  }

  const ProductCard = ({ product, mode }: { product: ProductView; mode?: "sale" | "receive" | "count" | "price" }) => (
    <View style={styles.productRow}>
      <View style={styles.productInfo}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productMeta}>{product.barcode || "بدون باركود"} · {product.unit}{product.location ? ` · ${product.location}` : ""}</Text><Text style={styles.productPrice}>{money(product.price)} <Text style={styles.stockMeta}>| متاح {qty(product.onHand)}</Text></Text></View>
      {mode === "sale" ? <Pressable style={styles.smallGreen} onPress={() => addToCart(product)}><Ionicons name="add" size={20} color={C.white} /><Text style={styles.smallGreenText}>أضف</Text></Pressable>
        : mode === "receive" ? <Pressable style={styles.smallGreen} onPress={() => addReceiptProduct(product)}><Ionicons name="add" size={20} color={C.white} /><Text style={styles.smallGreenText}>استلام</Text></Pressable>
          : mode === "count" ? <Pressable style={styles.smallLight} onPress={() => { setCountTarget(product); setCountValue(String(product.countedQty ?? product.onHand)); }}><Text style={styles.smallLightText}>جرد</Text></Pressable>
            : mode === "price" ? <Text style={styles.priceBig}>{money(product.price)}</Text>
              : <Text style={[styles.stockPill, Number(product.onHand) <= 0 && { color: C.red, backgroundColor: "#fff0ef" }]}>{qty(product.onHand)} {product.unit}</Text>}
    </View>
  );
  const searchBox = (placeholder: string, target: "sale" | "receive" | "inventory") => <View style={styles.searchRow}>
    <TextInput ref={target === "sale" ? posInputRef : undefined} value={search} onChangeText={setSearch} placeholder={placeholder} placeholderTextColor="#87958b" style={[styles.input, { flex: 1, marginBottom: 0 }]} onSubmitEditing={(event) => { void submitBarcode(target, event.nativeEvent.text); }} returnKeyType="search" autoCapitalize="none" />
    {Platform.OS !== "web" ? <Pressable accessibilityLabel="مسح الباركود بالكاميرا" onPress={() => setScannerOpen(true)} style={styles.scanBtn}><Ionicons name="barcode-outline" size={23} color={C.white} /></Pressable> : null}
    <Pressable onPress={() => submitBarcode(target)} style={styles.scanBtn}><Ionicons name="search" size={21} color={C.white} /></Pressable>
  </View>;

  const productScreen = (mode: "products" | "sale" | "inventory" | "receive" | "prices") => {
    const title = mode === "products" ? "المنتجات" : mode === "sale" ? "نقطة البيع" : mode === "inventory" ? "المخزون والجرد" : mode === "receive" ? "استلام المنتجات" : "استعلام السعر";
    return <View>
      <SectionTitle title={title} hint={mode === "sale" ? "امسح باركود المنتج أو ابحث بالاسم، ثم أضفه للفاتورة." : mode === "inventory" ? "سجّل الكمية الفعلية لتسوية رصيد المخزون." : undefined} />
      {mode === "products" ? <View style={styles.actionRow}><Action title="استيراد Excel/CSV" icon="document-outline" onPress={openImportPicker} /><Action title="صنف جديد" icon="add-circle-outline" secondary onPress={() => setProductModal(true)} /></View> : null}
      {mode === "sale" ? <Card><Text style={styles.fieldLabel}>الباركود أو اسم الصنف</Text>{Platform.OS === "web" ? <Text style={extraStyles.hotkeyHint}>F2 بيع · F4 دفع · F6 استلام · F7 جرد · F8 منتجات · ↑/↓ اختيار · +/- كمية · Delete حذف · Ctrl+Backspace مسح</Text> : null}{searchBox("امسح الباركود أو اكتب اسم المنتج ثم Enter", "sale")}
        {shiftQuery.data ? <View style={styles.statusLine}><View style={styles.dot} /><Text style={styles.successText}>وردية مفتوحة #{shiftQuery.data.id}</Text></View> : <Text style={styles.warnText}>افتح وردية من الرئيسية قبل الدفع.</Text>}
        {search ? items.slice(0, 8).map((product) => <ProductCard key={product.id} product={product} mode="sale" />) : null}
      </Card> : null}
      {mode === "receive" ? <Card><Field label="اسم المورد" value={supplier} onChangeText={setSupplier} placeholder="اسم المورد" /><Field label="رقم فاتورة المورد (اختياري)" value={invoiceNo} onChangeText={setInvoiceNo} placeholder="رقم الفاتورة" /><Text style={styles.fieldLabel}>أضف الأصناف بالباركود أو البحث</Text>{searchBox("باركود أو اسم المنتج", "receive")}{search ? items.slice(0, 8).map((product) => <ProductCard key={product.id} product={product} mode="receive" />) : null}</Card> : null}
      {mode === "inventory" ? <Card><Text style={styles.fieldLabel}>ابحث/امسح الصنف ثم سجّل الكمية الفعلية</Text>{searchBox("باركود أو اسم المنتج", "inventory")}{search ? items.slice(0, 12).map((product) => <ProductCard key={product.id} product={product} mode="count" />) : null}</Card> : null}
      {mode === "prices" ? <Card><Text style={styles.fieldLabel}>استعلام فوري عن السعر</Text><View style={styles.searchRow}><TextInput value={search} onChangeText={setSearch} placeholder="اسم المنتج أو الباركود" placeholderTextColor="#87958b" style={[styles.input, { flex: 1, marginBottom: 0 }]} autoCapitalize="none" /></View>{items.slice(0, 20).map((product) => <ProductCard key={product.id} product={product} mode="price" />)}</Card> : null}
      {mode === "products" ? <Card><View style={styles.listHeading}><Text style={styles.fieldLabel}>قائمة المنتجات</Text><Text style={styles.muted}>{productsQuery.data?.length ?? 0} صنف</Text></View><View style={styles.searchRow}><TextInput value={search} onChangeText={setSearch} placeholder="ابحث بالاسم أو الباركود أو المعرف" placeholderTextColor="#87958b" style={[styles.input, { flex: 1, marginBottom: 0 }]} /></View>{items.slice(0, 100).map((product) => <ProductCard key={product.id} product={product} />)}{!items.length ? <Empty text="لا توجد منتجات بعد. استورد جدول الأصناف أو أضف أول صنف." /> : null}</Card> : null}
      {mode === "sale" ? <Card><View style={styles.listHeading}><Text style={styles.fieldLabel}>سلة البيع</Text><Pressable onPress={() => { setCart([]); setSelectedCartProductId(null); }}><Text style={styles.dangerText}>مسح السلة</Text></Pressable></View>{cart.map((line) => <View key={line.product.id} style={[styles.cartRow, line.product.id === selectedCartProductId && extraStyles.cartRowSelected]}><Pressable style={{ flex: 1 }} onFocus={() => setSelectedCartProductId(line.product.id)} onPress={() => setSelectedCartProductId(line.product.id)} accessibilityRole="button" accessibilityLabel={`اختيار ${line.product.name}`}><Text style={styles.productName}>{line.product.name}</Text><Text style={styles.productMeta}>{money(line.product.price)} ×</Text></Pressable><TextInput value={String(line.quantity)} onChangeText={value => { const next = Number(value); if (Number.isFinite(next) && next >= 1) setCart(old => old.map(item => item.product.id === line.product.id ? { ...item, quantity: next } : item)); }} onFocus={() => setSelectedCartProductId(line.product.id)} selectTextOnFocus keyboardType="decimal-pad" style={styles.qtyInput} accessibilityLabel={`الكمية ${line.product.name}`} /><Text style={styles.productPrice}>{money(Number(line.product.price) * line.quantity)}</Text><Pressable accessibilityLabel={`حذف ${line.product.name}`} onPress={() => { setCart(old => old.filter(item => item.product.id !== line.product.id)); setSelectedCartProductId(null); }}><Ionicons name="trash-outline" size={20} color={C.red} /></Pressable></View>)}{cart.length ? <><View style={styles.totalLine}><Text style={styles.h2}>الإجمالي</Text><Text style={styles.totalAmount}>{money(cartTotal)}</Text></View><Action title="الدفع وتأكيد البيع" icon="card-outline" onPress={() => { setPaid(cartTotal.toFixed(2)); setCheckoutOpen(true); }} disabled={!shiftQuery.data || checkout.isPending} /></> : <Empty text="امسح باركود الصنف أو اختر منتجًا لإضافته إلى الفاتورة." />}</Card> : null}
      {mode === "receive" ? <Card><View style={styles.listHeading}><Text style={styles.fieldLabel}>أصناف الاستلام</Text><Text style={styles.muted}>{receiptLines.length} صنف</Text></View>{receiptLines.map((line) => <View key={line.product.id} style={styles.cartRow}><View style={{ flex: 1 }}><Text style={styles.productName}>{line.product.name}</Text><Text style={styles.productMeta}>تكلفة {money(line.cost)}</Text></View><TextInput style={styles.qtyInput} keyboardType="decimal-pad" value={String(line.quantity)} onChangeText={(value) => setReceiptLines((old) => old.map((item) => item.product.id === line.product.id ? { ...item, quantity: Number(value) || 0 } : item))} /><Pressable onPress={() => setReceiptLines((old) => old.filter((item) => item.product.id !== line.product.id))}><Ionicons name="trash-outline" size={20} color={C.red} /></Pressable></View>)}{receiptLines.length ? <Action title={receive.isPending ? "جارٍ حفظ الاستلام…" : "حفظ الاستلام وتحديث المخزون"} icon="save-outline" onPress={commitReceipt} disabled={receive.isPending} /> : <Empty text="أضف أصناف الفاتورة ليتم تحديث المخزون بعد الحفظ." />}</Card> : null}
    </View>;
  };

  const header = <View style={styles.topHeader}><View style={styles.headerBrand}><Image source={require("../../assets/images/icon.png")} style={styles.headerLogo} /><View><Text style={styles.headerTitle}>أسواق بدر</Text><Text style={styles.headerSub}>إدارة المتجر ونقطة البيع</Text></View></View><View style={styles.headerUser}><Text style={styles.employeeName}>{employee.name}</Text><Text style={styles.roleText}>{roleName(employee.role)}</Text><Pressable onPress={logoutStaff} style={styles.logoutBtn}><Ionicons name="log-out-outline" size={19} color={C.darkGreen} /><Text style={styles.logoutText}>خروج</Text></Pressable></View></View>;
  const screenContent = () => {
    if (screen === "products" || screen === "sale" || screen === "inventory" || screen === "receive" || screen === "prices") return productScreen(screen);
    if (screen === "staff") return <View>
      <SectionTitle title="الموظفون والحضور" hint="حسابات محلية لهذا الجهاز؛ لا تتم مزامنتها مع الأجهزة الأخرى." />
      <Card>
        <View style={styles.actionRow}>
          <Action title="إضافة موظف" icon="person-add-outline" onPress={() => setEmployeeModal(true)} />
          <Action title="تسجيل حضوري/انصرافي" icon="time-outline" secondary onPress={performClock} />
        </View>
        <Action title="تغيير كلمة مرور المدير" icon="key-outline" secondary onPress={() => setPasswordModal(true)} />
        {(staffQuery.data ?? []).map((staff) => <View key={staff.id} style={styles.productRow}>
          <View style={styles.productInfo}>
            <Text style={styles.productName}>{staff.name}</Text>
            <Text style={styles.productMeta}>{staff.code} · {roleName(staff.role)} · {staff.phone || "بدون هاتف"}</Text>
          </View>
          <Pressable disabled={staff.id === employee.id} onPress={async () => { await employeeActive.mutateAsync({ id: staff.id, active: !staff.active }); void staffQuery.refetch(); }}>
            <Text style={[styles.stockPill, !staff.active && { backgroundColor: "#f0f0f0", color: C.muted }]}>{staff.active ? "نشط" : "موقوف"}</Text>
          </Pressable>
        </View>)}
      </Card>
      <Card>
        <SectionTitle title="آخر الحركات" />
        {(attendanceQuery.data ?? []).map((event) => <View key={event.id} style={styles.simpleRow}>
          <Text style={styles.productName}>{event.employeeName}</Text>
          <Text style={event.event === "in" ? styles.successText : styles.warnText}>{event.event === "in" ? "حضور" : "انصراف"}</Text>
          <Text style={styles.muted}>{new Date(event.eventAt).toLocaleString("ar-EG")}</Text>
        </View>)}
      </Card>
    </View>;
    if (screen === "reports") return <View>
      <SectionTitle title="تقارير المتجر" hint="ملخص محلي للمبيعات والمخزون والورديات والموظفين." />
      <View style={styles.kpiRow}><KPI label="فواتير اليوم" value={String(summaryQuery.data?.count ?? 0)} icon="receipt-outline" /><KPI label="مبيعات اليوم" value={money(summaryQuery.data?.total)} icon="cash-outline" /><KPI label="نقدي مستلم" value={money(summaryQuery.data?.cash)} icon="wallet-outline" /></View>
      <Card><SectionTitle title="الأكثر مبيعًا اليوم" /><View style={styles.tableHeader}><Text style={[styles.tableText, { flex: 1 }]}>الصنف</Text><Text style={styles.tableText}>الكمية</Text><Text style={styles.tableText}>المبيعات</Text></View>{(bestQuery.data ?? []).map((row, i) => <View key={row.productId} style={styles.simpleRow}><Text style={styles.rank}>{i + 1}</Text><Text style={[styles.productName, { flex: 1 }]}>{row.name}</Text><Text style={styles.tableText}>{qty(row.quantity)}</Text><Text style={styles.productPrice}>{money(row.total)}</Text></View>)}{!bestQuery.data?.length ? <Empty text="ستظهر المنتجات بعد تسجيل عمليات بيع فعلية." /> : null}</Card>
      <Card><SectionTitle title="تقرير المخزون" hint={`${inventoryReportQuery.data?.productCount ?? 0} صنف · ${inventoryReportQuery.data?.outOfStockCount ?? 0} نافد · تكلفة الرصيد ${money(inventoryReportQuery.data?.inventoryCost)}`} />{(inventoryReportQuery.data?.products ?? []).slice(0, 20).map(product => <View key={product.id} style={styles.simpleRow}><Text style={[styles.productName, { flex: 1 }]}>{product.name}</Text><Text style={styles.tableText}>{qty(product.onHand)} {product.unit}</Text><Text style={styles.muted}>{money(Number(product.cost) * Number(product.onHand))}</Text></View>)}</Card>
      <Card><SectionTitle title="تقرير الورديات" hint="آخر 50 وردية مع حركة المبيعات والنقد والمصروفات." />{(shiftReportQuery.data ?? []).map(shift => <View key={shift.id} style={extraStyles.reportBlock}><Text style={styles.productName}>{shift.employeeName} · وردية #{shift.id} · {shift.status === "open" ? "مفتوحة" : "مغلقة"}</Text><Text style={styles.productMeta}>{new Date(shift.startedAt).toLocaleString("ar-EG")} · {shift.salesCount} فاتورة · إجمالي البيع {money(shift.salesTotal)}</Text><Text style={styles.productMeta}>النقد المتوقع {money(shift.expectedCash)} · نقد المصروفات {money(shift.cashExpenses)}{shift.actualCash != null ? ` · النقد الفعلي ${money(shift.actualCash)} · الفرق ${money(shift.difference)}` : ""}</Text></View>)}{!shiftReportQuery.data?.length ? <Empty text="لا توجد ورديات مسجلة بعد." /> : null}</Card>
      <Card><SectionTitle title="تقرير الموظفين والحضور اليومي" />{(employeeReportQuery.data ?? []).map(person => <View key={person.id} style={extraStyles.reportBlock}><Text style={styles.productName}>{person.name} · {roleName(person.role)} · {person.active ? "نشط" : "موقوف"}</Text><Text style={styles.productMeta}>الكود {person.code} · {person.attendanceCount} حركة حضور/انصراف · آخر حركة {person.lastAttendance ? `${person.lastAttendance.event === "in" ? "حضور" : "انصراف"} ${new Date(person.lastAttendance.eventAt).toLocaleTimeString("ar-EG")}` : "لا يوجد"}</Text><Text style={styles.productMeta}>{person.salesCount} فاتورة · مبيعات {money(person.salesTotal)} · {person.openShift ? "لديه وردية مفتوحة" : "لا توجد وردية مفتوحة"}</Text></View>)}</Card>
    </View>;
    return <View>
      <View style={styles.welcome}><Text style={styles.welcomeEyebrow}>لوحة المتجر</Text><Text style={styles.welcomeTitle}>صباح النشاط، {employee.name}</Text><Text style={styles.welcomeText}>تابع البيع والمخزون وحركة الفريق من مكان واحد.</Text></View>
      <View style={styles.kpiRow}><KPI label="عدد المنتجات" value={String(productsQuery.data?.length ?? 0)} icon="pricetags-outline" /><KPI label="مبيعات اليوم" value={canManage ? money(summaryQuery.data?.total) : "—"} icon="trending-up-outline" /><KPI label="وردية اليوم" value={shiftQuery.data ? "مفتوحة" : "غير مفتوحة"} icon="time-outline" /></View>
      <Card><View style={styles.actionRow}><Action title="تسجيل حضوري/انصرافي" icon="time-outline" secondary onPress={performClock} /></View></Card>
      {!shiftQuery.data && employee.role !== "stock" ? <Card style={styles.shiftCard}><View style={{ flex: 1 }}><Text style={styles.h2}>ابدأ وردية جديدة</Text><Text style={styles.muted}>سجّل رصيد بداية الصندوق قبل استقبال المبيعات.</Text></View><View style={styles.shiftActions}><TextInput value={openingCash} onChangeText={setOpeningCash} keyboardType="decimal-pad" style={styles.qtyInput} placeholder="رصيد البداية" /><Action title="فتح الوردية" icon="lock-open-outline" onPress={async () => { try { const result = await openShift.mutateAsync({ openingCash: Number(openingCash) || 0 }); void shiftQuery.refetch(); flash(`تم فتح الوردية رقم ${result.id}`); } catch (error) { flash(messageOf(error, "تعذر فتح الوردية")); } }} disabled={openShift.isPending} /></View></Card> : null}
      {shiftQuery.data ? <Card style={styles.openShift}><View style={styles.statusLine}><View style={styles.dot} /><Text style={styles.successText}>الوردية #{shiftQuery.data.id} مفتوحة منذ {new Date(shiftQuery.data.startedAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</Text></View><Action title="قفل الوردية" icon="lock-closed-outline" secondary onPress={() => { setCountValue("0"); setCountTarget({ id: -shiftQuery.data!.id, name: "قفل الوردية", barcode: null, externalId: null, cost: "0", price: "0", onHand: "0", countedQty: null, unit: "", location: null }); }} /></Card> : null}
      <SectionTitle title="الوصول السريع" hint="اختر عملية للبدء." />
      <View style={styles.quickGrid}>{visibleNav.filter((item) => item.id !== "home").map((item) => <Pressable key={item.id} onPress={() => { setScreen(item.id); setSearch(""); }} style={styles.quickTile}><View style={styles.quickIcon}><Ionicons name={item.icon} size={24} color={C.green} /></View><Text style={styles.quickTitle}>{item.title}</Text><Ionicons name="chevron-back" size={18} color={C.muted} /></Pressable>)}</View>
      {canManage ? <Card><SectionTitle title="الأكثر مبيعًا اليوم" />{(bestQuery.data ?? []).slice(0, 5).map((row, index) => <View key={row.productId} style={styles.simpleRow}><Text style={styles.rank}>{index + 1}</Text><Text style={[styles.productName, { flex: 1 }]}>{row.name}</Text><Text style={styles.muted}>{qty(row.quantity)} مباعة</Text></View>)}{!bestQuery.data?.length ? <Empty text="لا توجد مبيعات مسجلة حتى الآن." /> : null}</Card> : null}
    </View>;
  };
  const closeShiftModal = Boolean(countTarget && countTarget.id < 0);

  return <ScreenContainer className="flex-1" style={styles.screen}>
    {header}
    <View style={[styles.appBody, desktop ? styles.desktopBody : styles.mobileBody]}>
      {desktop ? <View style={styles.sidebar}><Text style={styles.navCaption}>القائمة الرئيسية</Text>{visibleNav.map((item) => <Pressable key={item.id} onPress={() => { setScreen(item.id); setSearch(""); }} style={[styles.navItem, screen === item.id && styles.navActive]}><Ionicons name={item.icon} size={20} color={screen === item.id ? C.green : C.muted} /><Text style={[styles.navText, screen === item.id && styles.navTextActive]}>{item.title}</Text></Pressable>)}<View style={styles.sidebarFoot}><Text style={styles.muted}>بيانات محلية على هذا الجهاز</Text><Text style={styles.version}>أسواق بدر · نظام البيع</Text></View></View> : null}
      <ScrollView style={styles.content} contentContainerStyle={[styles.contentInner, { maxWidth: desktop ? 1140 : 760 }]} keyboardShouldPersistTaps="handled">
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {screen === "accounts" ? <AccountsContent summary={summaryQuery.data} expenses={expensesQuery.data ?? []} onAdd={() => setExpenseModal(true)} /> : screenContent()}
      </ScrollView>
    </View>
    {!desktop ? <View style={styles.bottomNav}>{visibleNav.filter((item) => ["home", "sale", "products", "inventory", "prices"].includes(item.id)).map((item) => <Pressable key={item.id} onPress={() => { setScreen(item.id); setSearch(""); }} style={styles.bottomItem}><Ionicons name={item.icon} size={21} color={screen === item.id ? C.green : C.muted} /><Text style={[styles.bottomText, screen === item.id && { color: C.green }]}>{item.title}</Text></Pressable>)}</View> : null}

    <BarcodeScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={(barcode) => { setSearch(barcode); const target = screen === "sale" ? "sale" : screen === "receive" ? "receive" : "inventory"; void lookup(barcode).then((product) => { if (product && target === "sale") addToCart(product); else if (product && target === "receive") addReceiptProduct(product); else if (product) { setCountTarget(product); setCountValue(String(product.countedQty ?? product.onHand)); } else flash("لم يتم العثور على هذا الباركود"); }); }} />

    <AppModal visible={Boolean(importPreview)} title="معاينة استيراد المنتجات" onClose={() => setImportPreview(null)}>
      <Text style={styles.modalHint}>سيتم تحديث الصنف إذا تطابق المعرف الخارجي أو الباركود؛ راجع الصفوف قبل الاستيراد.</Text><View style={styles.kpiRow}><KPI label="صفوف جاهزة" value={String(importPreview?.items.length ?? 0)} icon="checkmark-circle-outline" /><KPI label="ملاحظات" value={String(importPreview?.issues.length ?? 0)} icon="alert-circle-outline" /></View>
      {importPreview?.items.slice(0, 6).map((item, index) => <View key={`${item.barcode}-${index}`} style={styles.simpleRow}><Text style={styles.productName}>{item.name}</Text><Text style={styles.muted}>{item.barcode || "—"}</Text></View>)}
      {importPreview?.issues.slice(0, 15).map((issue, i) => <Text key={i} style={styles.warnText}>{issue}</Text>)}
      <View style={styles.actionRow}><Action title="إلغاء" secondary onPress={() => setImportPreview(null)} /><Action title={importProducts.isPending ? "جارٍ الاستيراد…" : "استيراد الصفوف السليمة"} icon="document-text-outline" onPress={commitImport} disabled={!importPreview?.items.length || importProducts.isPending} /></View>
    </AppModal>
    <AppModal visible={productModal} title="إضافة منتج" onClose={() => setProductModal(false)}>
      <Field label="اسم المنتج" value={newProduct.name} onChangeText={(name) => setNewProduct({ ...newProduct, name })} placeholder="اسم الصنف" />
      <Field label="الباركود" value={newProduct.barcode} onChangeText={(barcode) => setNewProduct({ ...newProduct, barcode })} placeholder="امسح أو اكتب الباركود" keyboardType="numeric" />
      <View style={styles.formPair}><View style={{ flex: 1 }}><Field label="التكلفة" value={newProduct.cost} onChangeText={(cost) => setNewProduct({ ...newProduct, cost })} placeholder="0.00" keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Field label="سعر البيع" value={newProduct.price} onChangeText={(price) => setNewProduct({ ...newProduct, price })} placeholder="0.00" keyboardType="decimal-pad" /></View></View>
      <View style={styles.formPair}><View style={{ flex: 1 }}><Field label="الكمية في اليد" value={newProduct.onHand} onChangeText={(onHand) => setNewProduct({ ...newProduct, onHand })} placeholder="0" keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Field label="وحدة القياس" value={newProduct.unit} onChangeText={(unit) => setNewProduct({ ...newProduct, unit })} placeholder="قطعة" /></View></View>
      <Field label="الموقع" value={newProduct.location} onChangeText={(location) => setNewProduct({ ...newProduct, location })} placeholder="رف/مخزن" />
      <Action title="حفظ المنتج" icon="save-outline" onPress={commitProduct} disabled={createProduct.isPending} />
    </AppModal>
    <AppModal visible={Boolean(countTarget) && !closeShiftModal} title="تسجيل الجرد الفعلي" onClose={() => setCountTarget(null)}>
      <Text style={styles.modalHint}>{countTarget?.name} · الرصيد الحالي {qty(countTarget?.onHand)} {countTarget?.unit}</Text><Field label="الكمية المحسوبة" value={countValue} onChangeText={setCountValue} placeholder="الكمية" keyboardType="decimal-pad" autoFocus />
      <Text style={styles.muted}>عند الحفظ، تُحدّث الكمية الفعلية ويُسجل فرق الجرد في حركة المخزون.</Text><Action title="حفظ وتسوية المخزون" icon="checkmark-done-outline" onPress={commitCount} disabled={setCounted.isPending} />
    </AppModal>
    <AppModal visible={employeeModal} title="إضافة موظف" onClose={() => setEmployeeModal(false)}>
      <Field label="كود الموظف" value={newEmployee.code} onChangeText={(code) => setNewEmployee({ ...newEmployee, code })} placeholder="مثال: CSH01" />
      <Field label="اسم الموظف" value={newEmployee.name} onChangeText={(name) => setNewEmployee({ ...newEmployee, name })} placeholder="الاسم" />
      <Field label="رقم الهاتف" value={newEmployee.phone} onChangeText={(phone) => setNewEmployee({ ...newEmployee, phone })} placeholder="اختياري" keyboardType="numeric" />
      {newEmployee.role === "manager"
        ? <Field label="كلمة مرور المدير (8 أحرف على الأقل)" value={newEmployee.password} onChangeText={(password) => setNewEmployee({ ...newEmployee, password })} placeholder="كلمة مرور" secureTextEntry />
        : <Field label="PIN (4 إلى 12 رقمًا)" value={newEmployee.pin} onChangeText={(value) => setNewEmployee({ ...newEmployee, pin: value.replace(/\D/g, "").slice(0, 12) })} placeholder="رقم سري" keyboardType="numeric" secureTextEntry />}
      <Text style={styles.fieldLabel}>الدور</Text><View style={styles.roleRow}>{(["cashier", "stock", "manager"] as const).map((role) => <Pressable key={role} onPress={() => setNewEmployee({ ...newEmployee, role, pin: role === "manager" ? "" : newEmployee.pin, password: role === "manager" ? newEmployee.password : "" })} style={[styles.roleChip, newEmployee.role === role && styles.roleChipSelected]}><Text style={[styles.roleChipText, newEmployee.role === role && { color: C.green }]}>{roleName(role)}</Text></Pressable>)}</View>
      <Action title="حفظ الموظف" icon="person-add-outline" onPress={commitEmployee} disabled={employeeCreate.isPending} />
    </AppModal>
    <AppModal visible={passwordModal} title="تغيير كلمة مرور المدير" onClose={() => { setPasswordModal(false); setCurrentManagerPassword(""); setNextManagerPassword(""); }}>
      <Field label="كلمة المرور الحالية" value={currentManagerPassword} onChangeText={setCurrentManagerPassword} placeholder="الحالية" secureTextEntry />
      <Field label="كلمة المرور الجديدة (8 أحرف على الأقل)" value={nextManagerPassword} onChangeText={setNextManagerPassword} placeholder="الجديدة" secureTextEntry />
      <Action title={passwordChange.isPending ? "جارٍ التغيير…" : "حفظ كلمة المرور الجديدة"} icon="key-outline" onPress={commitManagerPassword} disabled={passwordChange.isPending} />
    </AppModal>
    <AppModal visible={expenseModal} title="تسجيل مصروف" onClose={() => setExpenseModal(false)}>
      <Field label="التصنيف" value={newExpense.category} onChangeText={(category) => setNewExpense({ ...newExpense, category })} placeholder="تشغيل، نقل، صيانة…" />
      <Field label="البيان" value={newExpense.description} onChangeText={(description) => setNewExpense({ ...newExpense, description })} placeholder="سبب المصروف" />
      <Field label="المبلغ" value={newExpense.amount} onChangeText={(amount) => setNewExpense({ ...newExpense, amount })} placeholder="0.00" keyboardType="decimal-pad" />
      <Text style={styles.fieldLabel}>طريقة الدفع</Text><View style={styles.roleRow}>{(["cash", "card", "wallet"] as const).map((method) => <Pressable key={method} onPress={() => setNewExpense({ ...newExpense, paymentMethod: method })} style={[styles.roleChip, newExpense.paymentMethod === method && styles.roleChipSelected]}><Text style={[styles.roleChipText, newExpense.paymentMethod === method && { color: C.green }]}>{paymentName(method)}</Text></Pressable>)}</View>
      <Action title="حفظ المصروف" icon="save-outline" onPress={commitExpense} disabled={addExpense.isPending} />
    </AppModal>
    <AppModal visible={checkoutOpen} title="تأكيد الدفع" onClose={() => setCheckoutOpen(false)}>
      <Text style={styles.paymentTotal}>{money(cartTotal)}</Text><Text style={styles.modalHint}>اختر طريقة الدفع وأدخل المبلغ المدفوع.</Text>
      <View style={styles.roleRow}>{(["cash", "card", "wallet"] as const).map((method) => <Pressable key={method} onPress={() => { setPaymentMethod(method); setPaid(cartTotal.toFixed(2)); }} style={[styles.roleChip, paymentMethod === method && styles.roleChipSelected]}><Text style={[styles.roleChipText, paymentMethod === method && { color: C.green }]}>{paymentName(method)}</Text></Pressable>)}</View>
      <Field label="المبلغ المدفوع" value={paid} onChangeText={setPaid} placeholder="0.00" keyboardType="decimal-pad" />
      <Action title={checkout.isPending ? "جارٍ حفظ البيع…" : "تأكيد البيع"} icon="checkmark-circle-outline" onPress={commitSale} disabled={checkout.isPending} />
    </AppModal>
    <AppModal visible={Boolean(countTarget) && Boolean(closeShiftModal)} title="قفل الوردية" onClose={() => setCountTarget(null)}>
      <Text style={styles.modalHint}>أدخل النقد الفعلي في الصندوق لمقارنته بالمبلغ المتوقع.</Text><Field label="النقد الفعلي" value={countValue} onChangeText={setCountValue} placeholder="0.00" keyboardType="decimal-pad" />
      <Action title="تأكيد قفل الوردية" icon="lock-closed-outline" onPress={async () => { const id = Math.abs(countTarget?.id || 0); try { const result = await closeShift.mutateAsync({ id, actualCash: Number(countValue) || 0 }); setCountTarget(null); void shiftQuery.refetch(); flash(`أُغلقت الوردية. المتوقع ${money(result.expected)}، الفرق ${money(result.difference)}`); } catch (error) { flash(messageOf(error, "تعذر قفل الوردية")); } }} disabled={closeShift.isPending} />
    </AppModal>
  </ScreenContainer>;
}

type AccountSummary = { total: string; expenses: string; purchases: string; grossProfit: string; net: string };
type ExpenseView = { id: number; category: string; description: string; amount: string; paymentMethod: "cash" | "card" | "wallet"; shiftId: number | null; createdAt: number; employeeName: string };
function AccountsContent({ summary, expenses, onAdd }: { summary?: AccountSummary; expenses: ExpenseView[]; onAdd: () => void }) {
  return <View>
    <SectionTitle title="الحسابات والمصروفات" hint="ملخص بيع وشراء اليوم ودفتر المصروفات المرتبط بالورديات." />
    <View style={styles.kpiRow}>
      <KPI label="مبيعات اليوم" value={money(summary?.total)} icon="cash-outline" />
      <KPI label="مشتريات اليوم" value={money(summary?.purchases)} icon="cart-outline" />
      <KPI label="مصروفات اليوم" value={money(summary?.expenses)} icon="receipt-outline" />
      <KPI label="هامش بعد المصروفات" value={money(summary?.net)} icon="trending-up-outline" />
    </View>
    <Card>
      <View style={styles.listHeading}><Text style={styles.fieldLabel}>دفتر المصروفات</Text><Action title="تسجيل مصروف" icon="add-circle-outline" onPress={onAdd} /></View>
      {expenses.map((entry) => <View key={entry.id} style={styles.simpleRow}>
        <View style={{ flex: 1 }}><Text style={styles.productName}>{entry.description}</Text><Text style={styles.productMeta}>{entry.category} · {entry.employeeName} · {new Date(entry.createdAt).toLocaleString("ar-EG")}</Text></View>
        <Text style={styles.productPrice}>{money(entry.amount)}</Text>
      </View>)}
      {!expenses.length ? <Empty text="لا توجد مصروفات مسجلة اليوم." /> : null}
    </Card>
    <Card>
      <SectionTitle title="ملخص نتيجة اليوم" />
      <View style={styles.simpleRow}><Text style={styles.productName}>تكلفة المشتريات الواردة</Text><Text style={styles.tableText}>{money(summary?.purchases)}</Text></View>
      <View style={styles.simpleRow}><Text style={styles.productName}>هامش إجمالي من المبيعات</Text><Text style={styles.tableText}>{money(summary?.grossProfit)}</Text></View>
      <View style={styles.simpleRow}><Text style={styles.productName}>مصروفات التشغيل المسجلة</Text><Text style={styles.tableText}>{money(summary?.expenses)}</Text></View>
      <Text style={styles.muted}>صافي اليوم تقدير تشغيلي (هامش تكلفة المنتجات المباعة ناقص المصروفات)، وليس دفترًا محاسبيًا ضريبيًا.</Text>
    </Card>
  </View>;
}

function Empty({ text }: { text: string }) { return <View style={styles.empty}><Ionicons name="file-tray-outline" size={30} color="#9eb3a5" /><Text style={styles.emptyText}>{text}</Text></View>; }
function KPI({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) { return <View style={styles.kpi}><View style={styles.kpiIcon}><Ionicons name={icon} size={18} color={C.green} /></View><Text style={styles.kpiLabel}>{label}</Text><Text style={styles.kpiValue} numberOfLines={1}>{value}</Text></View>; }
function roleName(role: string) { return role === "manager" ? "مدير" : role === "stock" ? "مخزون" : role === "cashier" ? "كاشير" : role; }
function paymentName(method: string) { return method === "cash" ? "نقدي" : method === "card" ? "بطاقة" : method === "wallet" ? "محفظة" : "—"; }
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message.replace(/^.*?\b(?:UNAUTHORIZED|FORBIDDEN|BAD_REQUEST|CONFLICT|NOT_FOUND|SERVICE_UNAVAILABLE):\s*/i, "") : fallback; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg }, center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loginWrap: { flex: 1, width: "100%", maxWidth: 460, alignSelf: "center", justifyContent: "center", padding: 20 }, logo: { width: 126, height: 126, alignSelf: "center", borderRadius: 28, marginBottom: 12 }, brandTitle: { fontSize: 30, fontWeight: "900", color: C.darkGreen, textAlign: "center" }, brandSubtitle: { color: C.muted, textAlign: "center", fontSize: 14, marginBottom: 22 }, loginFoot: { textAlign: "center", color: C.muted, fontSize: 12, marginTop: 16 },
  topHeader: { minHeight: 76, backgroundColor: C.white, borderBottomColor: C.line, borderBottomWidth: 1, paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }, headerBrand: { flexDirection: "row-reverse", alignItems: "center", gap: 10 }, headerLogo: { width: 48, height: 48, borderRadius: 12 }, headerTitle: { textAlign: "right", color: C.darkGreen, fontWeight: "900", fontSize: 19 }, headerSub: { textAlign: "right", color: C.muted, fontSize: 11 }, headerUser: { flexDirection: "row-reverse", alignItems: "center", gap: 10 }, employeeName: { color: C.ink, fontWeight: "700", fontSize: 13 }, roleText: { color: C.muted, fontSize: 11 }, logoutBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.pale, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }, logoutText: { color: C.darkGreen, fontWeight: "700", fontSize: 12 },
  appBody: { flex: 1, flexDirection: "row-reverse" }, desktopBody: {}, mobileBody: {}, sidebar: { width: 224, backgroundColor: C.white, borderLeftWidth: 1, borderLeftColor: C.line, paddingVertical: 20, paddingHorizontal: 12 }, navCaption: { color: C.muted, fontSize: 12, textAlign: "right", paddingHorizontal: 10, marginBottom: 10 }, navItem: { height: 48, flexDirection: "row-reverse", alignItems: "center", gap: 11, borderRadius: 12, paddingHorizontal: 12, marginBottom: 4 }, navActive: { backgroundColor: C.pale }, navText: { color: C.muted, fontSize: 13, fontWeight: "600", textAlign: "right" }, navTextActive: { color: C.darkGreen, fontWeight: "800" }, sidebarFoot: { marginTop: "auto", padding: 10, borderTopWidth: 1, borderColor: C.line }, version: { color: C.darkGreen, fontSize: 12, fontWeight: "700", marginTop: 5 }, content: { flex: 1 }, contentInner: { width: "100%", alignSelf: "center", padding: 20, paddingBottom: 38 }, bottomNav: { flexDirection: "row-reverse", backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line, justifyContent: "space-around", paddingVertical: 8, paddingBottom: Platform.OS === "web" ? 8 : 14 }, bottomItem: { minWidth: 56, alignItems: "center", gap: 3 }, bottomText: { color: C.muted, fontSize: 9, fontWeight: "700" },
  welcome: { backgroundColor: C.darkGreen, padding: 22, borderRadius: 18, marginBottom: 14 }, welcomeEyebrow: { color: "#b9e3ca", textAlign: "right", fontSize: 12, fontWeight: "700" }, welcomeTitle: { color: C.white, textAlign: "right", fontSize: 24, fontWeight: "900", marginTop: 8 }, welcomeText: { color: "#e1f2e7", textAlign: "right", marginTop: 6, fontSize: 13 }, kpiRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 10, marginBottom: 14 }, kpi: { flex: 1, minWidth: 120, backgroundColor: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 15, padding: 14 }, kpiIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.pale, marginBottom: 9 }, kpiLabel: { textAlign: "right", color: C.muted, fontSize: 11 }, kpiValue: { textAlign: "right", color: C.ink, fontSize: 19, fontWeight: "900", marginTop: 3 }, sectionTitle: { alignItems: "flex-end", marginTop: 12, marginBottom: 10 }, h2: { color: C.ink, fontSize: 18, fontWeight: "800", textAlign: "right" }, muted: { color: C.muted, fontSize: 12, textAlign: "right", marginTop: 4 }, card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 15, marginBottom: 12 },
  quickGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 9, marginBottom: 14 }, quickTile: { flexDirection: "row-reverse", alignItems: "center", gap: 10, minHeight: 70, width: "48%", flexGrow: 1, backgroundColor: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 12 }, quickIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.pale, alignItems: "center", justifyContent: "center" }, quickTitle: { flex: 1, textAlign: "right", color: C.ink, fontWeight: "700", fontSize: 12 }, shiftCard: { flexDirection: "row-reverse", flexWrap: "wrap", alignItems: "center", gap: 12 }, shiftActions: { flexDirection: "row-reverse", alignItems: "center", gap: 8, flex: 1 }, openShift: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 12, backgroundColor: "#f4fbf6" }, statusLine: { flexDirection: "row-reverse", alignItems: "center", gap: 7 }, dot: { width: 9, height: 9, borderRadius: 9, backgroundColor: C.green }, successText: { color: C.green, textAlign: "right", fontWeight: "700", fontSize: 12 }, warnText: { color: C.orange, textAlign: "right", fontSize: 12, marginVertical: 5 }, dangerText: { color: C.red, fontSize: 12, fontWeight: "700" },
  action: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, backgroundColor: C.green, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11, marginTop: 9 }, actionText: { color: C.white, textAlign: "center", fontWeight: "800", fontSize: 13 }, actionSecondary: { backgroundColor: C.pale, borderColor: "#c8e6d2", borderWidth: 1 }, actionSecondaryText: { color: C.darkGreen }, actionRow: { flexDirection: "row-reverse", gap: 8, marginBottom: 9 }, fieldWrap: { marginTop: 9, marginBottom: 3 }, fieldLabel: { color: C.muted, textAlign: "right", fontWeight: "700", fontSize: 12, marginBottom: 5 }, input: { minHeight: 44, color: C.ink, backgroundColor: "#fbfdfb", borderColor: C.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, textAlign: "right", fontSize: 14, marginBottom: 2 }, formPair: { flexDirection: "row-reverse", gap: 10 }, divider: { height: 1, backgroundColor: C.line, marginTop: 16, marginBottom: 5 }, notice: { backgroundColor: "#e8f6ee", color: C.darkGreen, textAlign: "right", borderWidth: 1, borderColor: "#c5e8d1", borderRadius: 11, padding: 10, marginBottom: 10, fontWeight: "700", fontSize: 12 },
  searchRow: { flexDirection: "row-reverse", gap: 7, alignItems: "center", marginTop: 5, marginBottom: 6 }, scanBtn: { width: 46, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: C.green, borderRadius: 10 }, productRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10, borderBottomColor: C.line, borderBottomWidth: 1, paddingVertical: 11 }, productInfo: { flex: 1, alignItems: "flex-end" }, productName: { color: C.ink, textAlign: "right", fontSize: 13, fontWeight: "700" }, productMeta: { color: C.muted, textAlign: "right", fontSize: 10, marginTop: 3 }, productPrice: { color: C.darkGreen, fontWeight: "800", fontSize: 13, textAlign: "right", marginTop: 4 }, stockMeta: { color: C.muted, fontSize: 10, fontWeight: "500" }, smallGreen: { flexDirection: "row-reverse", alignItems: "center", gap: 2, backgroundColor: C.green, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 }, smallGreenText: { color: C.white, fontSize: 11, fontWeight: "800" }, smallLight: { backgroundColor: C.pale, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 }, smallLightText: { color: C.darkGreen, fontWeight: "800", fontSize: 11 }, priceBig: { color: C.green, fontSize: 17, fontWeight: "900", textAlign: "left" }, stockPill: { backgroundColor: C.pale, color: C.darkGreen, fontSize: 11, fontWeight: "800", overflow: "hidden", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 }, listHeading: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }, cartRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10, borderBottomColor: C.line, borderBottomWidth: 1, paddingVertical: 10 }, totalLine: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", borderTopColor: C.line, borderTopWidth: 1, marginTop: 12, paddingTop: 12 }, totalAmount: { color: C.green, fontWeight: "900", fontSize: 22 }, qtyInput: { minWidth: 72, textAlign: "center", color: C.ink, backgroundColor: C.bg, borderRadius: 9, borderWidth: 1, borderColor: C.line, padding: 7, fontWeight: "700" }, empty: { alignItems: "center", justifyContent: "center", paddingVertical: 24, gap: 7 }, emptyText: { color: C.muted, textAlign: "center", fontSize: 12, lineHeight: 19 },
  modalBackdrop: { flex: 1, backgroundColor: "#12221bb0", justifyContent: "center", alignItems: "center", padding: 18 }, modalCard: { width: "100%", maxWidth: 540, maxHeight: "88%", backgroundColor: C.white, borderRadius: 18, padding: 17 }, modalHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", borderBottomColor: C.line, borderBottomWidth: 1, paddingBottom: 12, marginBottom: 7 }, modalHint: { color: C.muted, textAlign: "right", fontSize: 12, lineHeight: 20, marginVertical: 9 }, roleRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 7, marginTop: 8, marginBottom: 4 }, roleChip: { borderColor: C.line, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: C.white }, roleChipSelected: { borderColor: C.green, backgroundColor: C.pale }, roleChipText: { color: C.muted, fontSize: 12, fontWeight: "700" }, paymentTotal: { color: C.green, fontSize: 28, textAlign: "center", fontWeight: "900", marginTop: 14 }, simpleRow: { flexDirection: "row-reverse", alignItems: "center", gap: 9, borderBottomColor: C.line, borderBottomWidth: 1, paddingVertical: 10 }, rank: { width: 25, height: 25, overflow: "hidden", borderRadius: 9, textAlign: "center", textAlignVertical: "center", color: C.green, backgroundColor: C.pale, fontWeight: "900" }, tableHeader: { flexDirection: "row-reverse", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 8 }, tableText: { color: C.muted, fontSize: 11, textAlign: "right" },
});
