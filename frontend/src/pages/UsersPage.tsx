import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { Mail, Briefcase, ListTodo, Users, Search, X, ChevronRight, GitBranch, Activity, TrendingUp } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';import { useQuery } from '@tanstack/react-query';
import { snappy, pageEnter } from '@/lib/motion';
import { isTaskAssignedTo } from '@/lib/task-utils';
import { format, subDays } from 'date-fns';
import { analyticsApi } from '@/lib/analyticsApi';
import { OrgTree } from '@/components/analytics/OrgTree';
import { AIInsightsPanel } from '@/components/analytics/AIInsightsPanel';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import { orgNodeToInsightContext } from '@/lib/insightUtils';
import type { OrgNode } from '@/lib/analyticsApi';
import UserAvatar from '@/components/UserAvatar';
import { UserSkillBadges } from '@/components/SkillsPicker';
import { WipPage } from '@/pages/WipPage';
import PageHeader from '@/components/PageHeader';
import {
  PAGE_CHIP,
  PAGE_SHELL_SCROLL,
  SEGMENT_BAR,
  SEGMENT_BTN,
  SEGMENT_ICON,
} from '@/lib/page-styles';
import { FIELD_INPUT } from '@/lib/field-styles';

const isoFmt = (d: Date) => format(d, 'yyyy-MM-dd');
const defaultRange = () => ({ startDate: isoFmt(subDays(new Date(), 29)), endDate: isoFmt(new Date()) });


type UserTab = 'members' | 'organization' | 'wip';

const TAB_FROM_PARAM: Record<string, UserTab> = {
  organization: 'organization',
  wip: 'wip',
};

function tabFromSearchParam(tab: string | null): UserTab {
  if (tab && tab in TAB_FROM_PARAM) return TAB_FROM_PARAM[tab];
  return 'members';
}

const UsersPage = () => {
  const { users, tasks, projects, currentUser } = useAppStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<UserTab>(() => tabFromSearchParam(searchParams.get('tab')));
  const [range] = useState(defaultRange);
  const [selectedOrgNode, setSelectedOrgNode] = useState<OrgNode | null>(null);

  useEffect(() => {
    setActiveTab(tabFromSearchParam(searchParams.get('tab')));
  }, [searchParams]);

  const selectTab = (tab: UserTab) => {
    setActiveTab(tab);
    if (tab === 'members') {
      setSearchParams({});
    } else {
      setSearchParams({ tab });
    }
  };

  // ── Analytics queries (manager-only tabs) ─────────────────────────────────
  const orgQuery = useQuery({
    queryKey: ['analytics-org', range],
    queryFn: () => analyticsApi.getOrganization(range),
    enabled: isManager && activeTab === 'organization',
    staleTime: 60_000,
  });

  const filteredUsers = users
    .filter(u => {
      if (selectedProjectId) {
        const project = projects.find(p => p.id === selectedProjectId);
        if (!project?.members.includes(u.id)) return false;
      }
      if (searchTerm.trim()) {
        return u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.email.toLowerCase().includes(searchTerm.toLowerCase());
      }
      return true;
    });

  const managers = filteredUsers.filter(u => u.role === 'manager').length;
  const employees = filteredUsers.filter(u => u.role === 'employee').length;

  const orgInsightContext = useMemo(() => {
    const org = orgQuery.data;
    if (!org) return {};
    return {
      dateRange: range,
      summary: org.summary,
      managers: org.managers.map((m) => ({
        name: m.name,
        directReports: m.directReports,
        loggedHours: m.metrics.assignedHours,
        activeTasks: m.metrics.activeTasks,
      })),
      organizationTree: org.tree.map(orgNodeToInsightContext),
    };
  }, [orgQuery.data, range]);

  const selectedNodeContext = useMemo(() => {
    if (!selectedOrgNode) return {};
    return {
      dateRange: range,
      focus: orgNodeToInsightContext(selectedOrgNode),
    };
  }, [selectedOrgNode, range]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className={PAGE_SHELL_SCROLL}
    >
      <PageHeader
        icon={Users}
        eyebrow="Team"
        title="Team Members"
        subtitle={`${filteredUsers.length} ${filteredUsers.length === 1 ? 'person' : 'people'}${
          selectedProjectId
            ? ` in ${projects.find(p => p.id === selectedProjectId)?.name ?? ''}`
            : ' across all projects'
        }`}
        actions={
          <>
            {isManager && (
              <Link to="/users/forecast" className={`${PAGE_CHIP} text-violet-500 hover:bg-muted/60`}>
                <TrendingUp className={SEGMENT_ICON} />
                {ANALYTICS_LABELS.whatWillHappenNext}
              </Link>
            )}
            {managers > 0 && (
              <span className={PAGE_CHIP}>{managers} Manager{managers !== 1 ? 's' : ''}</span>
            )}
            {employees > 0 && (
              <span className={PAGE_CHIP}>{employees} Employee{employees !== 1 ? 's' : ''}</span>
            )}
          </>
        }
      >
        {/* Tab bar */}
        {isManager && (
          <div className={SEGMENT_BAR}>
            {([
              { id: 'members', label: 'Members', Icon: Users },
              { id: 'organization', label: 'Team Structure', Icon: GitBranch },
              { id: 'wip', label: "Who's Working On What", Icon: Activity },
            ] as { id: UserTab; label: string; Icon: React.ElementType }[]).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                className={SEGMENT_BTN(activeTab === id)}
              >
                <Icon className={SEGMENT_ICON} />{label}
              </button>
            ))}
          </div>
        )}

        {/* Members filters bar — only shown on Members tab */}
        {activeTab === 'members' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-7 items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-2.5 flex-1 min-w-[180px] max-w-xs">
              <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search by name or email…"
                className="bg-transparent text-[13px] focus:outline-none flex-1 placeholder:text-muted-foreground/40"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="text-muted-foreground/50 hover:text-foreground transition-colors shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="relative">
              <select
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                className={`${FIELD_INPUT} h-7 appearance-none rounded-lg py-0 pl-2.5 pr-8 text-[13px] cursor-pointer`}
              >
                <option value="">All Projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 rotate-90 pointer-events-none" />
            </div>
          </div>
        )}
      </PageHeader>

      {/* ── Members tab ──────────────────────────────────────────────────── */}
      {activeTab === 'members' && (<div>
        {filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4 border border-border/30">
              <Users className="h-7 w-7 text-muted-foreground/25" />
            </div>
            <h3 className="text-lg font-semibold text-foreground/60 mb-1">No members found</h3>
            <p className="text-sm text-muted-foreground/50">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredUsers.map((user, i) => {
              const activeTasks = tasks.filter(t => isTaskAssignedTo(t, user.id) && t.status !== 'completed').length;
              const userProjects = projects.filter(p => p.members.includes(user.id));
              const isAdmin = user.role === 'superadmin';
              const isManager = user.role === 'manager' || isAdmin;
              const roleLabel = isAdmin ? 'Admin' : user.role === 'manager' ? 'Manager' : 'Employee';

              return (
                <motion.div
                  key={user.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/users/${user.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/users/${user.id}`); } }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'tween', duration: 0.15, ease: 'easeOut', delay: i * 0.03 }}
                  whileHover={{ y: -3, transition: snappy }}
                  whileTap={{ scale: 0.98, transition: snappy }}
                  className="group rounded-2xl border border-border/30 bg-card hover:border-border/60 hover:shadow-lg transition-all duration-200 cursor-pointer text-left overflow-hidden"
                >
                  {/* Top accent strip based on role */}
                  <div className={`h-[3px] w-full ${isManager ? 'bg-primary' : 'bg-border/40'}`} />

                  <div className="p-5">
                    {/* Avatar + name */}
                    <div className="flex items-center gap-4 mb-4">
                      <UserAvatar name={user.name} avatar={user.avatar} size="lg" className="!rounded-2xl ring-2" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-bold text-foreground group-hover:text-primary transition-colors truncate">{user.name}</h3>
                        </div>
                        <UserSkillBadges skills={user.skills ?? []} />
                        <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-bold border mt-1.5 ${
                          isManager
                            ? 'bg-primary/10 text-primary border-primary/20'
                            : 'bg-muted/60 text-muted-foreground border-border/40'
                        }`}>
                          {roleLabel}
                        </span>
                      </div>
                    </div>

                    {/* Info rows */}
                    <div className="space-y-2.5 text-sm">
                      <div className="flex items-center gap-2.5 text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate text-xs">{user.email}</span>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        <span className={`text-xs font-semibold ${
                          activeTasks > 0 ? 'text-primary' : 'text-muted-foreground/50'
                        }`}>
                          {activeTasks} active task{activeTasks !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 mt-0.5" />
                        {userProjects.length === 0 ? (
                          <span className="text-xs text-muted-foreground/40 italic">No projects</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 min-w-0">
                            {userProjects.slice(0, 3).map(p => (
                              <span key={p.id} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 border border-border/40 text-muted-foreground/70 font-medium">
                                {p.name}
                              </span>
                            ))}
                            {userProjects.length > 3 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 border border-border/40 text-muted-foreground/50">
                                +{userProjects.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* View profile hint */}
                    <div className="mt-4 pt-3.5 border-t border-border/25 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground/40">View profile</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/25 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-150" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* ── Organization tab ──────────────────────────────────────────── */}
      {activeTab === 'organization' && isManager && (
        <div className="space-y-4">
          {orgQuery.data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[{label:'Total', value:orgQuery.data.summary.totalEmployees},{label:'Managers', value:orgQuery.data.summary.managers},{label:'Employees', value:orgQuery.data.summary.employees},{label:'CEOs', value:orgQuery.data.summary.ceos}].map(({label, value}) => (
                <div key={label} className="rounded-xl border border-border/50 bg-card/60 p-2.5 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/50 font-semibold">{label}</p>
                  <p className="text-lg font-bold text-foreground mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          )}
          <AIInsightsPanel
            scope="team_structure"
            context={orgInsightContext}
            autoLoad
          />
          {selectedOrgNode && (
            <AIInsightsPanel
              scope="team_structure"
              context={selectedNodeContext}
              autoLoad
              variant="inline"
            />
          )}
          <OrgTree
            nodes={orgQuery.data?.tree ?? []}
            loading={orgQuery.isLoading}
            selectedId={selectedOrgNode?.id ?? null}
            onSelectNode={setSelectedOrgNode}
          />
        </div>
      )}

      {/* ── Who's Working On What tab ───────────────────────────────────── */}
      {activeTab === 'wip' && isManager && <WipPage />}
    </motion.div>
  );
};

export default UsersPage;
