"use client";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useId, useRef, useState } from "react";
import { useProfile } from "./AppShell";
import ProfileNameForm from "./ProfileNameForm";
import { ADD_NAME_HINT, PROFILE_MENU_ITEMS, displayName, profileLabel } from "../lib/profileDisplay";

// The owner's own menu (#150): who they are, their plan and usage, name editing
// and sign out in one place. The same component sits at the bottom of the sidebar
// and in the phone top bar, so sign out never lives in the business switcher.
export default function ProfileMenu({ compact = false }: { compact?: boolean }) {
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const name = displayName(profile?.name ?? null);
  const label = profile ? profileLabel(profile.name) : "Profile";

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
      setEditing(false);
    };
    // Escape closes the menu and puts focus back on the button it came from.
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      setEditing(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", keydown);
    };
  }, [open]);

  // Opening with the keyboard or a click lands focus inside the menu.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("a, button, input")?.focus();
  }, [open]);

  return (
    <div className={compact ? "pl-profile pl-profile-compact" : "pl-profile"}>
      <button
        ref={buttonRef}
        type="button"
        className="pl-profile-button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={profile ? `Profile: ${label}` : "Profile"}
        onClick={() => { setOpen(value => !value); setEditing(false); }}
      >
        <span className="pl-avatar" aria-hidden="true">{profile?.initials ?? "…"}</span>
        <span className="pl-profile-label">{label}</span>
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} className="pl-profile-menu" role="group" aria-label="Profile">
          <div className="pl-profile-head">
            <strong>{label}</strong>
            {profile?.email ? <span className="pl-small pl-muted">{profile.email}</span> : null}
            {!name && !editing ? <p className="pl-small pl-muted" style={{ margin: 0 }}>{ADD_NAME_HINT}</p> : null}
          </div>
          {editing ? (
            <ProfileNameForm
              initial={profile?.name ?? ""}
              onSaved={() => { setEditing(false); buttonRef.current?.focus(); }}
              onCancel={() => { setEditing(false); buttonRef.current?.focus(); }}
            />
          ) : (
            <div className="pl-profile-items">
              {PROFILE_MENU_ITEMS.map(item => item.href
                ? <Link key={item.id} href={item.href} onClick={() => { setOpen(false); setEditing(false); }}>{item.label}</Link>
                : <button
                    key={item.id}
                    type="button"
                    className={item.id === "sign-out" ? "pl-profile-signout" : undefined}
                    onClick={() => item.id === "sign-out" ? void signOut({ callbackUrl: "/" }) : setEditing(true)}
                  >{item.label}</button>)}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
