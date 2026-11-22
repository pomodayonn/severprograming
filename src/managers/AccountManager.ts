// AccountManager（Entity Manager／フロントエンド）：アカウントの登録・ログイン・ログアウト。
// 中では NeonAuthClient を呼ぶだけ。ログインしたら SyncManager の pullAll() でデータを受け取る（Controller でつないである）。
// 【このファイルで何が起きているか】
// 登録・ログイン・ログアウトの「確認係」です（Manager）。
// 1. 画面から来たメールとパスワードを確かめる（空欄・メールの形・8〜16文字で英字と数字）
// 2. よければ NeonAuthClient に頼んで、Neon Auth に登録・ログインしてもらう
// 3. ログインできたら SyncManager.pullAll で、アカウント（Neon）のデータを端末に受け取る
// だめなときは AccountError（画面に出す文）を throw し、Controller がその文を画面に出す
import type { Student } from "../beans/Student";
import type { NeonAuthClient } from "../boundary/NeonAuthClient";
import { AppError } from "./common";
import { clearStudentData } from "../dao/idb";

/** 画面に出す文を持ったエラー。Controller がそのまま画面に渡す */
export class AccountError extends AppError {}

/** SyncManager のうち AccountManager が使う部分（ログインで受け取る・ログアウトの前に送る） */
export interface PullOnLogin { pullAll(): Promise<void>; sendAll(): Promise<boolean> }

/** logout() の結果。done＝ログアウトした、unsent＝アカウントに送れていない変更があるので、消さずに止めた */
export type LogoutResult = "done" | "unsent";

const nfkc = (s: string) => s.normalize("NFKC").trim(); // 全角英数で打っても同じ文字として扱う
const emailOk = (v: string) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export class AccountManager {
  constructor(private readonly authClient: NeonAuthClient, private readonly syncManager: PullOnLogin | null = null) {}

  /** お試しログインのときだけ true（画面に見本アカウントを出す・Google ボタンを隠す） */
  get isTrial(): boolean { return !this.authClient.neon; }

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
    if (clearLocal) {
      const s = await this.authClient.getSession();
      if (s) {
        const sent = (await this.syncManager?.sendAll()) ?? false;
        if (!sent && !force) return "unsent";
        await clearStudentData(s.studentId);
      }
    }
    await this.authClient.signOut();
    return "done";
  }

  /** ログイン中の学生（画面を開き直したとき・Google から戻ったときの確認にも使う） */
  async getCurrentStudent(): Promise<Student | null> {
    const s = await this.authClient.getSession();
    if (s) await this.pull();
    return s;
  }

  /** 8〜16文字で、英字と数字を両方含むか（Neon Auth が確認するか分からないので自分たちで確認する） */
  checkPassword(pass: string): boolean { return pass.length >= 8 && pass.length <= 16 && /[A-Za-z]/.test(pass) && /\d/.test(pass); }

  /** 受け取りに失敗しても、端末のデータでそのまま使えるようにする */
  private async pull() { try { await this.syncManager?.pullAll(); } catch { /* 同期の失敗はログインの失敗にしない */ } }
}