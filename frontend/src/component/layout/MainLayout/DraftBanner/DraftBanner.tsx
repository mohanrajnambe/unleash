import { FC, Fragment, useMemo, useState, VFC } from 'react';
import { Box, Button, styled, Typography } from '@mui/material';
import { ConditionallyRender } from 'component/common/ConditionallyRender/ConditionallyRender';
import { ChangeRequestSidebar } from 'component/changeRequest/ChangeRequestSidebar/ChangeRequestSidebar';
import { usePendingChangeRequests } from 'hooks/api/getters/usePendingChangeRequests/usePendingChangeRequests';
import { IChangeRequest } from 'component/changeRequest/changeRequest.types';
import { changesCount } from 'component/changeRequest/changesCount';

interface IDraftBannerProps {
    project: string;
}

const DraftBannerContentWrapper = styled(Box)(({ theme }) => ({
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(1, 0),
    [theme.breakpoints.down('lg')]: {
        padding: theme.spacing(1, 2),
    },
}));

const StyledBox = styled(Box)(({ theme }) => ({
    width: '1250px',
    marginLeft: 'auto',
    marginRight: 'auto',
    [theme.breakpoints.down('lg')]: {
        width: '1024px',
    },
    [theme.breakpoints.down(1024)]: {
        width: '100%',
        marginLeft: 0,
        marginRight: 0,
    },
    [theme.breakpoints.down('sm')]: {
        minWidth: '100%',
    },
}));

const DraftBannerContent: FC<{
    changeRequests: IChangeRequest[];
    onClick: () => void;
}> = ({ changeRequests, onClick }) => {
    const environments = changeRequests.map(({ environment }) => environment);
    const allChangesCount = changeRequests.reduce(
        (acc, curr) => acc + changesCount(curr),
        0,
    );
    const showOneLongExplanation =
        changeRequests.length === 1 &&
        ['Draft', 'In review', 'Approved'].includes(changeRequests[0].state);
    const explanation = showOneLongExplanation
        ? {
              Draft: ' that need to be reviewed',
              'In review': ' that are in review',
              Approved:
                  ' that are approved. Adding more changes will clear the approvals and require a new review',
          }[changeRequests[0].state as 'Draft' | 'In review' | 'Approved']
        : '';

    return (
        <StyledBox>
            <DraftBannerContentWrapper>
                <Typography variant='body2' sx={{ mr: 4 }}>
                    <strong>Change request mode</strong> – You have changes{' '}
                    <ConditionallyRender
                        condition={Boolean(environments)}
                        show={
                            <>
                                in{' '}
                                {environments.map((env, i) =>
                                    i === 0 ? (
                                        <Fragment key={env}>
                                            <strong>{env}</strong>
                                        </Fragment>
                                    ) : (
                                        <Fragment key={env}>
                                            {i === environments.length - 1
                                                ? ' and '
                                                : ', '}
                                            <strong>{env}</strong>
                                        </Fragment>
                                    ),
                                )}
                            </>
                        }
                    />
                    {explanation}.
                </Typography>
                <Button
                    variant='contained'
                    onClick={onClick}
                    sx={{ ml: 'auto' }}
                >
                    View changes ({allChangesCount})
                </Button>
            </DraftBannerContentWrapper>
        </StyledBox>
    );
};

const StickyBanner = styled(Box)(({ theme }) => ({
    position: 'sticky',
    top: -1,
    zIndex: 250 /* has to lower than header.zIndex and higher than body.zIndex */,
    borderTop: `1px solid ${theme.palette.warning.border}`,
    borderBottom: `1px solid ${theme.palette.warning.border}`,
    color: theme.palette.warning.contrastText,
    backgroundColor: theme.palette.warning.light,
}));

export const DraftBanner: VFC<IDraftBannerProps> = ({ project }) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { data, loading } = usePendingChangeRequests(project);

    const unfinishedChangeRequests = useMemo(
        () =>
            data?.filter((changeRequest) =>
                ['Draft', 'In review', 'Approved'].includes(
                    changeRequest.state,
                ),
            ),
        [data],
    );

    if ((!loading && !data) || data?.length === 0) {
        return null;
    }

    return (
        <StickyBanner>
            <ConditionallyRender
                condition={Boolean(unfinishedChangeRequests?.length)}
                show={
                    <DraftBannerContent
                        changeRequests={
                            unfinishedChangeRequests as IChangeRequest[]
                        }
                        onClick={() => {
                            setIsSidebarOpen(true);
                        }}
                    />
                }
            />
            <ChangeRequestSidebar
                project={project}
                open={isSidebarOpen}
                onClose={() => {
                    setIsSidebarOpen(false);
                }}
            />
        </StickyBanner>
    );
};
