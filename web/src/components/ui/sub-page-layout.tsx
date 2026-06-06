import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

interface MenuItem {
  labelKey: string;
  href: string;
}

interface SubPageLayoutProps {
  menuItems: MenuItem[];
}

export function SubPageLayout({ menuItems }: SubPageLayoutProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 gap-4 border-b border-border mb-3">
        {menuItems.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) =>
              `pb-2 text-sm transition-colors ${
                isActive
                  ? "border-b-2 border-foreground font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`
            }
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
