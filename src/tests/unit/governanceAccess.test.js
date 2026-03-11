import { describe, it, expect } from 'vitest';
import { canRouteGovernanceSubmission, getGovernanceReviewPermissions } from '../../utils/governanceAccess.js';

describe('governanceAccess utility', () => {
    it('canRouteGovernanceSubmission requires intake or governance manage permission', () => {
        const hasPermission = (permission) => permission === 'can_manage_intake';
        expect(canRouteGovernanceSubmission({ hasPermission })).toBe(true);
        expect(canRouteGovernanceSubmission({ hasPermission: () => false })).toBe(false);
    });

    it('blocks vote when user is not an eligible participant', () => {
        const review = {
            status: 'in-review',
            deadlinePassed: false,
            participants: [
                { userOid: 'another-user', participantRole: 'member', isEligibleVoter: true }
            ],
            policy: { decisionRequiresQuorum: false },
            scoreSummary: { quorumMet: true }
        };
        const result = getGovernanceReviewPermissions({
            review,
            currentUser: { oid: 'current-user' },
            hasPermission: (permission) => permission === 'can_vote_governance'
        });
        expect(result.canVote).toBe(false);
        expect(result.voteBlocker).toMatch(/eligible voter/i);
    });

    it('blocks chair decision when quorum is required and not met', () => {
        const review = {
            status: 'in-review',
            deadlinePassed: false,
            participants: [
                { userOid: 'chair-user', participantRole: 'chair', isEligibleVoter: true }
            ],
            policy: { decisionRequiresQuorum: true },
            scoreSummary: { quorumMet: false }
        };
        const result = getGovernanceReviewPermissions({
            review,
            currentUser: { oid: 'chair-user' },
            hasPermission: (permission) => ['can_vote_governance', 'can_decide_governance'].includes(permission)
        });
        expect(result.canDecide).toBe(false);
        expect(result.decisionBlocker).toMatch(/quorum/i);
    });
});

