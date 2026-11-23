// AccountManager（Entity Manager／フロントエンド）：アカウントの登録・ログイン・ログアウト。
// 中では NeonAuthClient を呼ぶだけ。ログインしたら SyncManager の pullAll() でデータを受け取る（Controller でつないである）。
// 【このファイルで何が起きているか】
// 登録・ログイン・ログアウトの「確認係」です（Manager）。
// 1. 画面から来たメールとパスワードを確かめる（空欄・メールの形・8〜16文字で英字と数字）
// 2. よければ NeonAuthClient に頼んで、Neon Auth に登録・ログインしてもらう
// 3. ログインできたら SyncManager.pullAll で、アカウント（Neon）のデータを端末に受け取る
//    11/23：ページを開き直したとき（getCurrentStudent）は、前回受け取ってから30分以内なら受け取らない（pullIfStale）。
//    すぐに別の端末の変更を見たいときは、ヘッダーの「最新にする」（refresh）で受け取り直す
// だめなときは AccountError（画面に出す文）を throw し、Controller がその文を画面に出す
import type { Student } from "../beans/Student";
import type { NeonAuthClient } from "../boundary/NeonAuthClient";
import { AppError } from "./common";
import { clearStudentData } from "../dao/idb";

/** 画面に出す文を持ったエラー。Controller がそのまま画面に渡す */
export class AccountError extends AppError {}

/** SyncManager のうち AccountManager が使う部分（ログインで受け取る・ログアウトの前に送る） */
export interface PullOnLogin {
  readonly enabled: boolean;
  pullAll(): Promise<void>; pullIfStale(): Promise<void>; forgetPull(studentId: string): Promise<void>; sendAll(): Promise<boolean>;
}

/** logout() の結果。done＝ログアウトした、unsent＝アカウントに送れていない変更があるので、消さずに止めた */
export type LogoutResult = "done" | "unsent";

const nfkc = (s: string) => s.normalize("NFKC").trim(); // 全角英数で打っても同じ文字として扱う
const emailOk = (v: string) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export class AccountManager {
  constructor(private readonly authClient: NeonAuthClient, private readonly syncManager: PullOnLogin | null = null) {}

  /** 登録する。空欄・メールの形・パスワードの条件・再入力との一致を確かめてから Neon Auth に頼む */
  async register(mail: string, pass: string, passConfirm: string): Promise<Student> {
    const m = nfkc(mail).toLowerCase(), p = nfkc(pass);
    if (!m || !pass || !passConfirm) throw new AccountError("入力されていない項目があります");
    if (!emailOk(m)) throw new AccountError("メールアドレスの形が正しくありません");
    if (!this.checkPassword(p)) throw new AccountError("パスワードは8〜16文字で、英字と数字の両方を含めてください");
    if (p !== nfkc(passConfirm)) throw new AccountError("パスワードが一致しません");
    const r = await this.authClient.signUp(m, p); // メールの重複は Neon Auth がエラーで返す
    if (!r.ok) throw new AccountError(r.error);
    return r.student; // 新規登録はアカウントにデータがないので pullAll はしない
  }

  /** ログインして、続けてアカウントのデータを受け取る */
  async login(mail: string, pass: string): Promise<Student> {
    if (!nfkc(mail) || !pass) throw new AccountError("入力されていない項目があります");
    const r = await this.authClient.signIn(nfkc(mail).toLowerCase(), nfkc(pass));
    if (!r.ok) throw new AccountError(r.error);
    await this.pull();
    return r.student;
  }

  /** Google でログインする。ページが移動するので、戻ってきた後は getCurrentStudent() で分かる */
  async loginWithGoogle(): Promise<void> { await this.authClient.signInWithGoogle(); }

  /**
   * ログアウトする。ふだんは端末のデータは消さない。
   * clearLocal が true なら、この端末にあるこの学生のデータも消す（学校のPCなど、ほかの人も使う端末のため）。
   *   1. まだアカウントに送っていない変更を先に送る
   *   2. 送れなかったら、消さずに "unsent" を返す（画面が「消すと戻せません」と確認する）
   *   3. 確認して force を true にして呼び直したら、送れなくても消す
   */
  async logout(clearLocal = false, force = false): Promise<LogoutResult> {
    const s = await this.authClient.getSession();
    if (clearLocal && s) {
      const sent = (await this.syncManager?.sendAll()) ?? false;
      if (!sent && !force) return "unsent";
      await clearStudentData(s.studentId);
    }
    if (s) await this.syncManager?.forgetPull(s.studentId).catch(() => {}); // 11/23：次のログインでは必ず受け取り直す
    await this.authClient.signOut();
    return "done";
  }

  /**
   * ログイン中の学生（画面を開き直したとき・Google から戻ったときの確認にも使う）。
   * 11/23：前回受け取ってから30分以内なら受け取らず、端末のデータをそのまま使う
   */
  async getCurrentStudent(): Promise<Student | null> {
    const s = await this.authClient.getSession();
    if (s) { try { await this.syncManager?.pullIfStale(); } catch { /* 同期の失敗はログインの失敗にしない */ } }
    return s;
  }

  /**
   * 「最新にする」ボタン（11/23）。30分たっていなくても、アカウントのデータを受け取り直す。
   * pull() と違って、失敗したら画面に知らせる（押した人は結果を知りたいので）
   */
  async refresh(): Promise<void> {
    if (!this.syncManager?.enabled) throw new AccountError("アカウントと同期する設定がないため、最新にできません");
    if (!(await this.authClient.getSession())) throw new AccountError("ログインしていないため、最新にできません");
    try { await this.syncManager.pullAll(); }
    catch (e) { throw new AccountError(e instanceof Error && e.message ? e.message : "最新にできませんでした。時間をおいて試してください"); }
  }

  /** 8〜16文字で、英字と数字を両方含むか（Neon Auth が確認するか分からないので自分たちで確認する） */
  checkPassword(pass: string): boolean { return pass.length >= 8 && pass.length <= 16 && /[A-Za-z]/.test(pass) && /\d/.test(pass); }

  /** 受け取りに失敗しても、端末のデータでそのまま使えるようにする */
  private async pull() { try { await this.syncManager?.pullAll(); } catch { /* 同期の失敗はログインの失敗にしない */ } }
}