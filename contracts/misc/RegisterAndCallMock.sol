pragma solidity ^0.4.24;

import "../RegisterAndCall.sol";

contract RegisterAndCallMock is RegisterAndCall {

    event ReceiveRegistration(address usersSenderAddress, address usersUniqueId, bytes data);

    function receiveRegistration(address _usersSenderAddress, address _usersUniqueId, bytes _data) external {
        emit ReceiveRegistration(_usersSenderAddress, _usersUniqueId, _data);
    }
}
